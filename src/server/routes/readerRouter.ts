import crypto from 'crypto';
import { Router } from 'express';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../db/index.ts';
import {
  authorProfiles,
  bookmarks,
  chapters,
  follows,
  novels,
  readingListItems,
  readingLists,
  readingProgress,
  userProfiles,
} from '../../db/schema.ts';
import { LiteraRequest, requireAuth } from '../auth.ts';

export const readerRouter = Router();
readerRouter.use(requireAuth);

const progressSchema = z.object({
  novelId: z.string().min(1),
  chapterId: z.string().min(1),
  scrollPercent: z.number().min(0).max(100),
  progressPercent: z.number().min(0).max(100),
  expectedVersion: z.number().int().positive().optional(),
});

const bookmarkSchema = z.object({
  novelId: z.string().min(1),
  chapterId: z.string().min(1),
  paragraphIndex: z.number().int().min(0).default(0),
  quoteExcerpt: z.string().max(400).default(''),
  note: z.string().max(500).default(''),
});

const listSchema = z.object({
  name: z.string().min(2).max(80),
  description: z.string().max(300).default(''),
  visibility: z.enum(['PRIVATE', 'PUBLIC']).default('PRIVATE'),
});

readerRouter.get('/library', async (req: LiteraRequest, res) => {
  try {
    const userId = req.actor!.id;

    const progressRows = await db
      .select({
        id: readingProgress.id,
        novelId: readingProgress.novelId,
        chapterId: readingProgress.chapterId,
        scrollPercent: readingProgress.scrollPercent,
        progressPercent: readingProgress.progressPercent,
        version: readingProgress.version,
        lastReadAt: readingProgress.lastReadAt,
        novelTitle: novels.title,
        novelSlug: novels.slug,
        novelCoverUrl: novels.coverUrl,
        chapterTitle: chapters.title,
        chapterNumber: chapters.chapterNumber,
      })
      .from(readingProgress)
      .innerJoin(novels, eq(readingProgress.novelId, novels.id))
      .innerJoin(chapters, eq(readingProgress.chapterId, chapters.id))
      .where(eq(readingProgress.userId, userId))
      .orderBy(desc(readingProgress.lastReadAt));

    const bookmarkRows = await db
      .select({
        id: bookmarks.id,
        novelId: bookmarks.novelId,
        chapterId: bookmarks.chapterId,
        paragraphIndex: bookmarks.paragraphIndex,
        quoteExcerpt: bookmarks.quoteExcerpt,
        note: bookmarks.note,
        createdAt: bookmarks.createdAt,
        novelTitle: novels.title,
        novelSlug: novels.slug,
        chapterTitle: chapters.title,
        chapterNumber: chapters.chapterNumber,
      })
      .from(bookmarks)
      .innerJoin(novels, eq(bookmarks.novelId, novels.id))
      .innerJoin(chapters, eq(bookmarks.chapterId, chapters.id))
      .where(eq(bookmarks.userId, userId))
      .orderBy(desc(bookmarks.createdAt));

    const lists = await db
      .select()
      .from(readingLists)
      .where(eq(readingLists.userId, userId))
      .orderBy(desc(readingLists.updatedAt));

    const listIds = lists.map((l) => l.id);
    const items = listIds.length
      ? await db
          .select({
            listId: readingListItems.listId,
            novelId: readingListItems.novelId,
            addedAt: readingListItems.addedAt,
            novelTitle: novels.title,
            novelSlug: novels.slug,
            coverUrl: novels.coverUrl,
          })
          .from(readingListItems)
          .innerJoin(novels, eq(readingListItems.novelId, novels.id))
          .where(inArray(readingListItems.listId, listIds))
      : [];

    const itemsByList = new Map<string, typeof items>();
    for (const item of items) {
      const arr = itemsByList.get(item.listId) || [];
      arr.push(item);
      itemsByList.set(item.listId, arr);
    }

    const followedRows = await db
      .select({
        authorId: follows.authorId,
        createdAt: follows.createdAt,
        penName: authorProfiles.penName,
        displayName: userProfiles.displayName,
        verificationStatus: authorProfiles.verificationStatus,
      })
      .from(follows)
      .leftJoin(authorProfiles, eq(follows.authorId, authorProfiles.userId))
      .leftJoin(userProfiles, eq(follows.authorId, userProfiles.userId))
      .where(eq(follows.followerId, userId));

    res.json({
      history: progressRows,
      bookmarks: bookmarkRows,
      lists: lists.map((l) => ({ ...l, items: itemsByList.get(l.id) || [] })),
      following: followedRows,
    });
  } catch (error) {
    console.error('GET /api/reader/library error:', error);
    res.status(500).json({ error: 'Failed to load personal library.' });
  }
});

readerRouter.post('/progress', async (req: LiteraRequest, res) => {
  try {
    const parsed = progressSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid progress payload.' });
      return;
    }

    const userId = req.actor!.id;
    const { novelId, chapterId, scrollPercent, progressPercent, expectedVersion } = parsed.data;

    const [existing] = await db
      .select()
      .from(readingProgress)
      .where(and(eq(readingProgress.userId, userId), eq(readingProgress.novelId, novelId)))
      .limit(1);

    if (!existing) {
      const [inserted] = await db
        .insert(readingProgress)
        .values({
          id: `prog_${crypto.randomUUID()}`,
          userId,
          novelId,
          chapterId,
          scrollPercent,
          progressPercent,
          version: 1,
          lastReadAt: new Date(),
          updatedAt: new Date(),
        })
        .returning();

      res.json({ progress: inserted });
      return;
    }

    if (expectedVersion !== undefined && existing.version !== expectedVersion) {
      res.status(409).json({
        error: 'Reading progress modified from another session.',
        currentProgress: existing,
      });
      return;
    }

    const [updated] = await db
      .update(readingProgress)
      .set({
        chapterId,
        scrollPercent,
        progressPercent,
        version: existing.version + 1,
        lastReadAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(readingProgress.id, existing.id), eq(readingProgress.version, existing.version)))
      .returning();

    if (!updated) {
      res.status(409).json({ error: 'Concurrent progress update detected.' });
      return;
    }

    res.json({ progress: updated });
  } catch (error) {
    console.error('POST /api/reader/progress error:', error);
    res.status(500).json({ error: 'Failed to synchronize reading progress.' });
  }
});

readerRouter.post('/bookmarks', async (req: LiteraRequest, res) => {
  try {
    const parsed = bookmarkSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid bookmark fields.' });
      return;
    }

    const [created] = await db
      .insert(bookmarks)
      .values({
        id: `bmk_${crypto.randomUUID()}`,
        userId: req.actor!.id,
        novelId: parsed.data.novelId,
        chapterId: parsed.data.chapterId,
        paragraphIndex: parsed.data.paragraphIndex,
        quoteExcerpt: parsed.data.quoteExcerpt,
        note: parsed.data.note,
      })
      .returning();

    res.status(201).json({ bookmark: created });
  } catch (error) {
    console.error('POST /api/reader/bookmarks error:', error);
    res.status(500).json({ error: 'Failed to save bookmark.' });
  }
});

readerRouter.delete('/bookmarks/:id', async (req: LiteraRequest, res) => {
  try {
    const id = String(req.params.id || '');
    const [deleted] = await db
      .delete(bookmarks)
      .where(and(eq(bookmarks.id, id), eq(bookmarks.userId, req.actor!.id)))
      .returning();

    if (!deleted) {
      res.status(404).json({ error: 'Bookmark not found.' });
      return;
    }

    res.json({ deleted: true });
  } catch (error) {
    console.error('DELETE bookmark error:', error);
    res.status(500).json({ error: 'Failed to remove bookmark.' });
  }
});

readerRouter.post('/lists', async (req: LiteraRequest, res) => {
  try {
    const parsed = listSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid reading list details.' });
      return;
    }

    const [created] = await db
      .insert(readingLists)
      .values({
        id: `list_${crypto.randomUUID()}`,
        userId: req.actor!.id,
        name: parsed.data.name.trim(),
        description: parsed.data.description.trim(),
        visibility: parsed.data.visibility,
      })
      .returning();

    res.status(201).json({ list: { ...created, items: [] } });
  } catch (error) {
    console.error('POST /api/reader/lists error:', error);
    res.status(500).json({ error: 'Failed to create reading list.' });
  }
});

readerRouter.post('/lists/:listId/items', async (req: LiteraRequest, res) => {
  try {
    const listId = String(req.params.listId || '');
    const novelId = String(req.body?.novelId || '');
    if (!novelId) {
      res.status(400).json({ error: 'novelId is required.' });
      return;
    }

    const [list] = await db
      .select()
      .from(readingLists)
      .where(and(eq(readingLists.id, listId), eq(readingLists.userId, req.actor!.id)))
      .limit(1);

    if (!list) {
      res.status(404).json({ error: 'Reading list not found.' });
      return;
    }

    await db
      .insert(readingListItems)
      .values({ listId, novelId })
      .onConflictDoNothing();

    await db
      .update(readingLists)
      .set({ updatedAt: new Date() })
      .where(eq(readingLists.id, listId));

    res.status(201).json({ added: true });
  } catch (error) {
    console.error('Add list item error:', error);
    res.status(500).json({ error: 'Failed to add novel to list.' });
  }
});

readerRouter.delete('/lists/:listId/items/:novelId', async (req: LiteraRequest, res) => {
  try {
    const listId = String(req.params.listId || '');
    const novelId = String(req.params.novelId || '');
    const [list] = await db
      .select()
      .from(readingLists)
      .where(and(eq(readingLists.id, listId), eq(readingLists.userId, req.actor!.id)))
      .limit(1);

    if (!list) {
      res.status(404).json({ error: 'Reading list not found.' });
      return;
    }

    await db
      .delete(readingListItems)
      .where(and(eq(readingListItems.listId, listId), eq(readingListItems.novelId, novelId)));

    res.json({ removed: true });
  } catch (error) {
    console.error('Remove list item error:', error);
    res.status(500).json({ error: 'Failed to remove novel from list.' });
  }
});

readerRouter.delete('/lists/:listId', async (req: LiteraRequest, res) => {
  try {
    const listId = String(req.params.listId || '');
    const [deleted] = await db
      .delete(readingLists)
      .where(and(eq(readingLists.id, listId), eq(readingLists.userId, req.actor!.id)))
      .returning();

    if (!deleted) {
      res.status(404).json({ error: 'Reading list not found.' });
      return;
    }

    res.json({ deleted: true });
  } catch (error) {
    console.error('Delete list error:', error);
    res.status(500).json({ error: 'Failed to delete reading list.' });
  }
});

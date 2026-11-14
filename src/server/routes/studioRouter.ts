import crypto from 'crypto';
import { Router } from 'express';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../db/index.ts';
import {
  authorProfiles,
  chapterVersions,
  chapters,
  follows,
  genres,
  notifications,
  novelGenres,
  novels,
  publicationEvents,
  systemConfigs,
} from '../../db/schema.ts';
import { LiteraRequest, requireAuth, requireRole } from '../auth.ts';
import {
  analyzeReadabilityViaPython,
  diffRevisionsViaPython,
  sanitizeManuscriptViaPython,
} from '../python-bridge.ts';
import { appendLiteraAudit, sanitizeEditorialContent } from '../security.ts';

export const studioRouter = Router();
studioRouter.use(requireAuth, requireRole('AUTHOR', 'EDITOR', 'ADMIN'));

const createNovelSchema = z.object({
  title: z.string().min(2).max(160),
  subtitle: z.string().max(220).default(''),
  synopsis: z.string().min(20).max(3000),
  coverUrl: z.string().max(400).default(''),
  language: z.string().min(2).max(16).default('en'),
  genreIds: z.array(z.number().int().positive()).min(1).max(3),
});

const updateNovelSchema = z.object({
  title: z.string().min(2).max(160).optional(),
  subtitle: z.string().max(220).optional(),
  synopsis: z.string().min(20).max(3000).optional(),
  coverUrl: z.string().max(400).optional(),
  completionStatus: z.enum(['ONGOING', 'COMPLETED', 'HIATUS']).optional(),
  genreIds: z.array(z.number().int().positive()).min(1).max(3).optional(),
  submitForReview: z.boolean().optional(),
  expectedVersion: z.number().int().positive(),
});

const createChapterSchema = z.object({
  title: z.string().min(2).max(180),
  contentHtml: z.string().default('<p></p>'),
});

const updateChapterSchema = z.object({
  title: z.string().min(2).max(180).optional(),
  contentHtml: z.string().optional(),
  changeSummary: z.string().max(200).optional(),
  createRevision: z.boolean().default(false),
  expectedVersion: z.number().int().positive(),
});

const publishChapterSchema = z.object({
  mode: z.enum(['IMMEDIATE', 'SCHEDULED']),
  scheduledFor: z.string().optional(),
});

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 72) || 'untitled'
  );
}

async function recalculateNovelStats(novelId: string) {
  const chaps = await db.select().from(chapters).where(eq(chapters.novelId, novelId));
  const publishedOrActive = chaps.filter((c) => c.status !== 'ARCHIVED');
  const totalWords = publishedOrActive.reduce((acc, c) => acc + c.wordCount, 0);
  await db
    .update(novels)
    .set({
      totalWords,
      chapterCount: publishedOrActive.length,
      updatedAt: new Date(),
    })
    .where(eq(novels.id, novelId));
}

async function assertNovelOwnership(novelId: string, actorId: number, role: string) {
  const [novel] = await db.select().from(novels).where(eq(novels.id, novelId)).limit(1);
  if (!novel) return { error: 404 as const, novel: null };
  if (novel.authorId !== actorId && role !== 'ADMIN') {
    return { error: 403 as const, novel: null };
  }
  return { error: null, novel };
}

studioRouter.get('/novels', async (req: LiteraRequest, res) => {
  try {
    const actor = req.actor!;
    const myNovels = await db
      .select()
      .from(novels)
      .where(eq(novels.authorId, actor.id))
      .orderBy(desc(novels.updatedAt));

    const [authorProf] = await db
      .select()
      .from(authorProfiles)
      .where(eq(authorProfiles.userId, actor.id))
      .limit(1);

    const novelIds = myNovels.map((n) => n.id);
    const ngRows = novelIds.length
      ? await db
          .select({ novelId: novelGenres.novelId, id: genres.id, slug: genres.slug, name: genres.name })
          .from(novelGenres)
          .innerJoin(genres, eq(novelGenres.genreId, genres.id))
          .where(inArray(novelGenres.novelId, novelIds))
      : [];

    const genreMap = new Map<string, Array<{ id: number; slug: string; name: string }>>();
    for (const row of ngRows) {
      const arr = genreMap.get(row.novelId) || [];
      arr.push({ id: row.id, slug: row.slug, name: row.name });
      genreMap.set(row.novelId, arr);
    }

    const totalViews = myNovels.reduce((sum, n) => sum + n.viewCount, 0);
    const totalWords = myNovels.reduce((sum, n) => sum + n.totalWords, 0);
    const rated = myNovels.filter((n) => n.ratingCount > 0);
    const avgRating = rated.length
      ? Number((rated.reduce((s, n) => s + n.avgRating, 0) / rated.length).toFixed(2))
      : 0;

    res.json({
      novels: myNovels.map((n) => ({ ...n, genres: genreMap.get(n.id) || [] })),
      analytics: {
        novelCount: myNovels.length,
        publishedCount: myNovels.filter((n) => n.status === 'PUBLISHED').length,
        totalViews,
        totalWords,
        avgRating,
        followerCount: authorProf?.followerCount || 0,
        verificationStatus: authorProf?.verificationStatus || 'UNVERIFIED',
      },
    });
  } catch (error) {
    console.error('GET /api/studio/novels error:', error);
    res.status(500).json({ error: 'Failed to load author workspace.' });
  }
});

studioRouter.post('/novels', async (req: LiteraRequest, res) => {
  try {
    const parsed = createNovelSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid novel details.', details: parsed.error.flatten() });
      return;
    }

    const actor = req.actor!;
    const id = `novel-${crypto.randomUUID().slice(0, 12)}`;
    const baseSlug = slugify(parsed.data.title);
    const slug = `${baseSlug}-${crypto.randomBytes(2).toString('hex')}`;

    const created = await db.transaction(async (tx) => {
      const [novel] = await tx
        .insert(novels)
        .values({
          id,
          authorId: actor.id,
          title: parsed.data.title.trim(),
          slug,
          subtitle: parsed.data.subtitle.trim(),
          synopsis: parsed.data.synopsis.trim(),
          coverUrl:
            parsed.data.coverUrl.trim() || '/assets/editorial/cover_glass_astrolabe_1794634569418.jpg',
          language: parsed.data.language,
          status: 'DRAFT',
          version: 1,
        })
        .returning();

      for (const gId of parsed.data.genreIds) {
        await tx.insert(novelGenres).values({ novelId: id, genreId: gId }).onConflictDoNothing();
      }
      return novel;
    });

    await appendLiteraAudit({
      actorId: actor.id,
      actorEmail: actor.email,
      action: 'NOVEL_CREATED',
      resourceType: 'NOVEL',
      resourceId: id,
      ip: req.ip,
      metadata: { title: parsed.data.title },
    });

    res.status(201).json({ novel: created });
  } catch (error) {
    console.error('POST /api/studio/novels error:', error);
    res.status(500).json({ error: 'Failed to create novel.' });
  }
});

studioRouter.patch('/novels/:id', async (req: LiteraRequest, res) => {
  try {
    const novelId = String(req.params.id || '');
    const parsed = updateNovelSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid novel update payload.', details: parsed.error.flatten() });
      return;
    }

    const check = await assertNovelOwnership(novelId, req.actor!.id, req.actor!.role);
    if (check.error === 404) {
      res.status(404).json({ error: 'Novel not found.' });
      return;
    }
    if (check.error === 403 || !check.novel) {
      res.status(403).json({ error: 'Forbidden: you do not own this manuscript.' });
      return;
    }

    if (check.novel.version !== parsed.data.expectedVersion) {
      res.status(409).json({
        error: 'Manuscript conflict: this novel was updated in another session.',
        currentVersion: check.novel.version,
      });
      return;
    }

    let nextStatus = check.novel.status;
    let publishedAt = check.novel.publishedAt;

    if (parsed.data.submitForReview) {
      const [cfg] = await db
        .select()
        .from(systemConfigs)
        .where(eq(systemConfigs.key, 'editorial.require_novel_approval'))
        .limit(1);
      const requireApproval = cfg ? JSON.parse(cfg.valueJson) !== false : true;
      nextStatus = requireApproval ? 'PENDING_REVIEW' : 'PUBLISHED';
      if (nextStatus === 'PUBLISHED' && !publishedAt) {
        publishedAt = new Date();
      }
    }

    const updated = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(novels)
        .set({
          ...(parsed.data.title !== undefined ? { title: parsed.data.title.trim() } : {}),
          ...(parsed.data.subtitle !== undefined ? { subtitle: parsed.data.subtitle.trim() } : {}),
          ...(parsed.data.synopsis !== undefined ? { synopsis: parsed.data.synopsis.trim() } : {}),
          ...(parsed.data.coverUrl !== undefined ? { coverUrl: parsed.data.coverUrl.trim() } : {}),
          ...(parsed.data.completionStatus !== undefined
            ? { completionStatus: parsed.data.completionStatus }
            : {}),
          status: nextStatus,
          publishedAt,
          version: check.novel!.version + 1,
          updatedAt: new Date(),
        })
        .where(and(eq(novels.id, novelId), eq(novels.version, parsed.data.expectedVersion)))
        .returning();

      if (!row) return null;

      if (parsed.data.genreIds) {
        await tx.delete(novelGenres).where(eq(novelGenres.novelId, novelId));
        for (const gId of parsed.data.genreIds) {
          await tx.insert(novelGenres).values({ novelId, genreId: gId }).onConflictDoNothing();
        }
      }

      if (parsed.data.submitForReview) {
        await tx.insert(publicationEvents).values({
          id: `pub_${crypto.randomUUID()}`,
          novelId,
          eventType: 'SUBMIT_NOVEL',
          scheduledFor: new Date(),
          status: nextStatus === 'PUBLISHED' ? 'PUBLISHED' : 'PENDING',
          idempotencyKey: `submit-${novelId}-v${row.version}`,
          processedAt: nextStatus === 'PUBLISHED' ? new Date() : null,
        });
      }

      return row;
    });

    if (!updated) {
      res.status(409).json({ error: 'Concurrent modification prevented.' });
      return;
    }

    await appendLiteraAudit({
      actorId: req.actor!.id,
      actorEmail: req.actor!.email,
      action: parsed.data.submitForReview ? 'NOVEL_SUBMITTED_FOR_REVIEW' : 'NOVEL_UPDATED',
      resourceType: 'NOVEL',
      resourceId: novelId,
      ip: req.ip,
      metadata: { status: updated.status, version: updated.version },
    });

    res.json({ novel: updated });
  } catch (error) {
    console.error('PATCH /api/studio/novels/:id error:', error);
    res.status(500).json({ error: 'Failed to update novel.' });
  }
});

studioRouter.get('/novels/:id/chapters', async (req: LiteraRequest, res) => {
  try {
    const novelId = String(req.params.id || '');
    const check = await assertNovelOwnership(novelId, req.actor!.id, req.actor!.role);
    if (check.error === 404) {
      res.status(404).json({ error: 'Novel not found.' });
      return;
    }
    if (check.error === 403 || !check.novel) {
      res.status(403).json({ error: 'Forbidden.' });
      return;
    }

    const list = await db
      .select()
      .from(chapters)
      .where(eq(chapters.novelId, novelId))
      .orderBy(asc(chapters.chapterNumber));

    res.json({ novel: check.novel, chapters: list });
  } catch (error) {
    console.error('GET studio chapters error:', error);
    res.status(500).json({ error: 'Failed to load chapters.' });
  }
});

studioRouter.post('/novels/:id/chapters', async (req: LiteraRequest, res) => {
  try {
    const novelId = String(req.params.id || '');
    const parsed = createChapterSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid chapter details.' });
      return;
    }

    const check = await assertNovelOwnership(novelId, req.actor!.id, req.actor!.role);
    if (check.error === 404) {
      res.status(404).json({ error: 'Novel not found.' });
      return;
    }
    if (check.error === 403 || !check.novel) {
      res.status(403).json({ error: 'Forbidden.' });
      return;
    }

    const existingChaps = await db
      .select({ chapterNumber: chapters.chapterNumber })
      .from(chapters)
      .where(eq(chapters.novelId, novelId))
      .orderBy(desc(chapters.chapterNumber))
      .limit(1);

    const nextNum = (existingChaps[0]?.chapterNumber || 0) + 1;
    const preClean = sanitizeEditorialContent(parsed.data.contentHtml);
    const pySan = await sanitizeManuscriptViaPython(preClean);

    const chapId = `chap-${crypto.randomUUID().slice(0, 12)}`;
    const created = await db.transaction(async (tx) => {
      const [ch] = await tx
        .insert(chapters)
        .values({
          id: chapId,
          novelId,
          chapterNumber: nextNum,
          title: parsed.data.title.trim(),
          slug: slugify(parsed.data.title),
          status: 'DRAFT',
          contentHtml: pySan.sanitized_html,
          plainExcerpt: pySan.plain_excerpt,
          wordCount: pySan.word_count,
          readingMinutes: pySan.reading_minutes,
          currentVersionNumber: 1,
          version: 1,
        })
        .returning();

      await tx.insert(chapterVersions).values({
        id: `ver-${chapId}-1`,
        chapterId: chapId,
        versionNumber: 1,
        title: parsed.data.title.trim(),
        contentHtml: pySan.sanitized_html,
        wordCount: pySan.word_count,
        checksumSha256: pySan.checksum_sha256,
        changeSummary: 'Initial draft created',
        createdBy: req.actor!.id,
      });

      return ch;
    });

    await recalculateNovelStats(novelId);
    res.status(201).json({ chapter: created });
  } catch (error) {
    console.error('POST studio chapter error:', error);
    res.status(500).json({ error: 'Failed to create chapter.' });
  }
});

studioRouter.patch('/chapters/:id', async (req: LiteraRequest, res) => {
  try {
    const chapterId = String(req.params.id || '');
    const parsed = updateChapterSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid chapter payload.' });
      return;
    }

    const [chapter] = await db.select().from(chapters).where(eq(chapters.id, chapterId)).limit(1);
    if (!chapter) {
      res.status(404).json({ error: 'Chapter not found.' });
      return;
    }

    const check = await assertNovelOwnership(chapter.novelId, req.actor!.id, req.actor!.role);
    if (check.error === 403 || !check.novel) {
      res.status(403).json({ error: 'Forbidden.' });
      return;
    }

    if (chapter.version !== parsed.data.expectedVersion) {
      res.status(409).json({
        error: 'Optimistic concurrency conflict: chapter was modified elsewhere.',
        currentVersion: chapter.version,
      });
      return;
    }

    const nextTitle = parsed.data.title !== undefined ? parsed.data.title.trim() : chapter.title;
    const rawHtml = parsed.data.contentHtml !== undefined ? parsed.data.contentHtml : chapter.contentHtml;
    const preClean = sanitizeEditorialContent(rawHtml);
    const pySan = await sanitizeManuscriptViaPython(preClean);
    const readability = await analyzeReadabilityViaPython(pySan.sanitized_html);

    const nextVersionNum = parsed.data.createRevision
      ? chapter.currentVersionNumber + 1
      : chapter.currentVersionNumber;

    const updated = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(chapters)
        .set({
          title: nextTitle,
          slug: slugify(nextTitle),
          contentHtml: pySan.sanitized_html,
          plainExcerpt: pySan.plain_excerpt,
          wordCount: pySan.word_count,
          readingMinutes: pySan.reading_minutes,
          currentVersionNumber: nextVersionNum,
          version: chapter.version + 1,
          updatedAt: new Date(),
        })
        .where(and(eq(chapters.id, chapterId), eq(chapters.version, parsed.data.expectedVersion)))
        .returning();

      if (!row) return null;

      if (parsed.data.createRevision) {
        await tx.insert(chapterVersions).values({
          id: `ver-${chapterId}-${nextVersionNum}`,
          chapterId,
          versionNumber: nextVersionNum,
          title: nextTitle,
          contentHtml: pySan.sanitized_html,
          wordCount: pySan.word_count,
          checksumSha256: pySan.checksum_sha256,
          changeSummary: parsed.data.changeSummary?.trim() || `Snapshot v${nextVersionNum}`,
          createdBy: req.actor!.id,
        });
      }

      return row;
    });

    if (!updated) {
      res.status(409).json({ error: 'Concurrent edit conflict.' });
      return;
    }

    await recalculateNovelStats(chapter.novelId);
    res.json({ chapter: updated, readability, strippedTags: pySan.stripped_tags });
  } catch (error) {
    console.error('PATCH studio chapter error:', error);
    res.status(500).json({ error: 'Failed to save chapter.' });
  }
});

studioRouter.get('/chapters/:id/versions', async (req: LiteraRequest, res) => {
  try {
    const chapterId = String(req.params.id || '');
    const [chapter] = await db.select().from(chapters).where(eq(chapters.id, chapterId)).limit(1);
    if (!chapter) {
      res.status(404).json({ error: 'Chapter not found.' });
      return;
    }

    const check = await assertNovelOwnership(chapter.novelId, req.actor!.id, req.actor!.role);
    if (check.error === 403 || !check.novel) {
      res.status(403).json({ error: 'Forbidden.' });
      return;
    }

    const versions = await db
      .select()
      .from(chapterVersions)
      .where(eq(chapterVersions.chapterId, chapterId))
      .orderBy(desc(chapterVersions.versionNumber));

    res.json({ versions });
  } catch (error) {
    console.error('GET chapter versions error:', error);
    res.status(500).json({ error: 'Failed to load revision history.' });
  }
});

studioRouter.get('/chapters/:id/diff', async (req: LiteraRequest, res) => {
  try {
    const chapterId = String(req.params.id || '');
    const fromVer = Number(req.query.from);
    const toVer = Number(req.query.to);

    const [chapter] = await db.select().from(chapters).where(eq(chapters.id, chapterId)).limit(1);
    if (!chapter) {
      res.status(404).json({ error: 'Chapter not found.' });
      return;
    }

    const check = await assertNovelOwnership(chapter.novelId, req.actor!.id, req.actor!.role);
    if (check.error === 403 || !check.novel) {
      res.status(403).json({ error: 'Forbidden.' });
      return;
    }

    const [vFrom] = await db
      .select()
      .from(chapterVersions)
      .where(and(eq(chapterVersions.chapterId, chapterId), eq(chapterVersions.versionNumber, fromVer)))
      .limit(1);

    const [vTo] = await db
      .select()
      .from(chapterVersions)
      .where(and(eq(chapterVersions.chapterId, chapterId), eq(chapterVersions.versionNumber, toVer)))
      .limit(1);

    if (!vFrom || !vTo) {
      res.status(404).json({ error: 'Requested revision versions not found.' });
      return;
    }

    const diff = await diffRevisionsViaPython(vFrom.contentHtml, vTo.contentHtml);
    res.json({ fromVersion: fromVer, toVersion: toVer, diff });
  } catch (error) {
    console.error('GET chapter diff error:', error);
    res.status(500).json({ error: 'Failed to compute revision diff.' });
  }
});

studioRouter.post('/chapters/:id/restore/:versionNumber', async (req: LiteraRequest, res) => {
  try {
    const chapterId = String(req.params.id || '');
    const verNum = Number(req.params.versionNumber);

    const [chapter] = await db.select().from(chapters).where(eq(chapters.id, chapterId)).limit(1);
    if (!chapter) {
      res.status(404).json({ error: 'Chapter not found.' });
      return;
    }

    const check = await assertNovelOwnership(chapter.novelId, req.actor!.id, req.actor!.role);
    if (check.error === 403 || !check.novel) {
      res.status(403).json({ error: 'Forbidden.' });
      return;
    }

    const [targetVer] = await db
      .select()
      .from(chapterVersions)
      .where(and(eq(chapterVersions.chapterId, chapterId), eq(chapterVersions.versionNumber, verNum)))
      .limit(1);

    if (!targetVer) {
      res.status(404).json({ error: 'Target revision not found.' });
      return;
    }

    const nextVerNum = chapter.currentVersionNumber + 1;
    const pySan = await sanitizeManuscriptViaPython(targetVer.contentHtml);

    const updated = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(chapters)
        .set({
          title: targetVer.title,
          contentHtml: pySan.sanitized_html,
          plainExcerpt: pySan.plain_excerpt,
          wordCount: pySan.word_count,
          readingMinutes: pySan.reading_minutes,
          currentVersionNumber: nextVerNum,
          version: chapter.version + 1,
          updatedAt: new Date(),
        })
        .where(eq(chapters.id, chapterId))
        .returning();

      await tx.insert(chapterVersions).values({
        id: `ver-${chapterId}-${nextVerNum}`,
        chapterId,
        versionNumber: nextVerNum,
        title: targetVer.title,
        contentHtml: pySan.sanitized_html,
        wordCount: pySan.word_count,
        checksumSha256: pySan.checksum_sha256,
        changeSummary: `Restored from revision v${verNum}`,
        createdBy: req.actor!.id,
      });

      return row;
    });

    await recalculateNovelStats(chapter.novelId);
    res.json({ chapter: updated });
  } catch (error) {
    console.error('Restore chapter version error:', error);
    res.status(500).json({ error: 'Failed to restore chapter revision.' });
  }
});

studioRouter.post('/chapters/:id/publish', async (req: LiteraRequest, res) => {
  try {
    const chapterId = String(req.params.id || '');
    const parsed = publishChapterSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid publication schedule.' });
      return;
    }

    const [chapter] = await db.select().from(chapters).where(eq(chapters.id, chapterId)).limit(1);
    if (!chapter) {
      res.status(404).json({ error: 'Chapter not found.' });
      return;
    }

    const check = await assertNovelOwnership(chapter.novelId, req.actor!.id, req.actor!.role);
    if (check.error === 403 || !check.novel) {
      res.status(403).json({ error: 'Forbidden.' });
      return;
    }

    const isScheduled = parsed.data.mode === 'SCHEDULED' && parsed.data.scheduledFor;
    const schedDate = isScheduled ? new Date(parsed.data.scheduledFor!) : new Date();
    if (isScheduled && Number.isNaN(schedDate.getTime())) {
      res.status(400).json({ error: 'Invalid scheduled date.' });
      return;
    }

    const immediate = !isScheduled || schedDate.getTime() <= Date.now();
    const updated = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(chapters)
        .set({
          status: immediate ? 'PUBLISHED' : 'SCHEDULED',
          scheduledPublishAt: immediate ? null : schedDate,
          publishedAt: immediate ? new Date() : null,
          version: chapter.version + 1,
          updatedAt: new Date(),
        })
        .where(eq(chapters.id, chapterId))
        .returning();

      await tx.insert(publicationEvents).values({
        id: `pub_${crypto.randomUUID()}`,
        novelId: chapter.novelId,
        chapterId,
        eventType: immediate ? 'PUBLISH_CHAPTER' : 'SCHEDULE_CHAPTER',
        scheduledFor: schedDate,
        status: immediate ? 'PUBLISHED' : 'PENDING',
        idempotencyKey: `pub-${chapterId}-v${chapter.version + 1}`,
        processedAt: immediate ? new Date() : null,
      });

      if (immediate && check.novel!.status === 'PUBLISHED') {
        const followerRows = await tx
          .select({ followerId: follows.followerId })
          .from(follows)
          .where(eq(follows.authorId, check.novel!.authorId));

        for (const f of followerRows) {
          await tx.insert(notifications).values({
            id: `notif_${crypto.randomUUID()}`,
            userId: f.followerId,
            type: 'NEW_CHAPTER',
            title: `New chapter in ${check.novel!.title}`,
            message: `Chapter ${chapter.chapterNumber}: ${chapter.title} is now available to read.`,
            linkPath: `/novel/${check.novel!.slug}/read/${chapter.id}`,
          });
        }
      }

      return row;
    });

    await appendLiteraAudit({
      actorId: req.actor!.id,
      actorEmail: req.actor!.email,
      action: immediate ? 'CHAPTER_PUBLISHED' : 'CHAPTER_SCHEDULED',
      resourceType: 'CHAPTER',
      resourceId: chapterId,
      ip: req.ip,
      metadata: { novelId: chapter.novelId, scheduledFor: schedDate.toISOString() },
    });

    res.json({ chapter: updated });
  } catch (error) {
    console.error('POST publish chapter error:', error);
    res.status(500).json({ error: 'Failed to publish or schedule chapter.' });
  }
});

import crypto from 'crypto';
import { Router } from 'express';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../db/index.ts';
import {
  authorProfiles,
  chapters,
  comments,
  follows,
  notifications,
  novels,
  reports,
  reviews,
  systemConfigs,
} from '../../db/schema.ts';
import { LiteraRequest, requireAuth } from '../auth.ts';
import { appendLiteraAudit, createRateLimiter, sanitizeCommentContent } from '../security.ts';

export const communityRouter = Router();
communityRouter.use(requireAuth);

const communityRateLimit = createRateLimiter({
  windowMs: 60_000,
  maxRequests: 30,
  keyPrefix: 'community',
});

const reviewSchema = z.object({
  rating: z.number().int().min(1).max(5),
  title: z.string().min(3).max(140),
  body: z.string().min(10).max(2500),
});

const commentSchema = z.object({
  body: z.string().min(2).max(1500),
  parentCommentId: z.string().optional(),
});

const reportSchema = z.object({
  targetType: z.enum(['NOVEL', 'CHAPTER', 'REVIEW', 'COMMENT', 'AUTHOR']),
  targetId: z.string().min(1),
  reason: z.string().min(3).max(120),
  details: z.string().max(1500).default(''),
});

communityRouter.post('/novels/:novelId/reviews', communityRateLimit, async (req: LiteraRequest, res) => {
  try {
    const novelId = String(req.params.novelId || '');
    const parsed = reviewSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid review details.', details: parsed.error.flatten() });
      return;
    }

    const [novel] = await db
      .select()
      .from(novels)
      .where(and(eq(novels.id, novelId), eq(novels.status, 'PUBLISHED')))
      .limit(1);

    if (!novel) {
      res.status(404).json({ error: 'Published novel not found.' });
      return;
    }

    const userId = req.actor!.id;
    const saved = await db.transaction(async (tx) => {
      const [rev] = await tx
        .insert(reviews)
        .values({
          id: `rev_${crypto.randomUUID()}`,
          userId,
          novelId,
          rating: parsed.data.rating,
          title: parsed.data.title.trim(),
          body: parsed.data.body.trim(),
        })
        .onConflictDoUpdate({
          target: [reviews.userId, reviews.novelId],
          set: {
            rating: parsed.data.rating,
            title: parsed.data.title.trim(),
            body: parsed.data.body.trim(),
            updatedAt: new Date(),
          },
        })
        .returning();

      const allReviews = await tx
        .select({ rating: reviews.rating })
        .from(reviews)
        .where(and(eq(reviews.novelId, novelId), eq(reviews.status, 'PUBLISHED')));

      const ratingCount = allReviews.length;
      const avgRating = ratingCount
        ? Number((allReviews.reduce((s, r) => s + r.rating, 0) / ratingCount).toFixed(2))
        : 0;

      await tx.update(novels).set({ avgRating, ratingCount }).where(eq(novels.id, novelId));

      if (novel.authorId !== userId) {
        await tx.insert(notifications).values({
          id: `notif_${crypto.randomUUID()}`,
          userId: novel.authorId,
          type: 'NEW_REVIEW',
          title: `New ${parsed.data.rating}-star review on ${novel.title}`,
          message: `${req.actor!.displayName} wrote: "${parsed.data.title.trim()}"`,
          linkPath: `/novel/${novel.slug}`,
        });
      }

      return { rev, avgRating, ratingCount };
    });

    res.status(201).json({
      review: saved.rev,
      avgRating: saved.avgRating,
      ratingCount: saved.ratingCount,
    });
  } catch (error) {
    console.error('POST review error:', error);
    res.status(500).json({ error: 'Failed to submit review.' });
  }
});

communityRouter.post('/chapters/:chapterId/comments', communityRateLimit, async (req: LiteraRequest, res) => {
  try {
    const chapterId = String(req.params.chapterId || '');
    const parsed = commentSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Comment text must be between 2 and 1500 characters.' });
      return;
    }

    const [cfg] = await db
      .select()
      .from(systemConfigs)
      .where(eq(systemConfigs.key, 'community.comments_enabled'))
      .limit(1);
    if (cfg && JSON.parse(cfg.valueJson) === false) {
      res.status(403).json({ error: 'Chapter comments are currently disabled by administration.' });
      return;
    }

    const [chapter] = await db
      .select()
      .from(chapters)
      .where(and(eq(chapters.id, chapterId), eq(chapters.status, 'PUBLISHED')))
      .limit(1);

    if (!chapter) {
      res.status(404).json({ error: 'Published chapter not found.' });
      return;
    }

    const [novel] = await db.select().from(novels).where(eq(novels.id, chapter.novelId)).limit(1);

    const escaped = parsed.data.body
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    const cleanHtml = sanitizeCommentContent(`<p>${escaped.replace(/\n+/g, '</p><p>')}</p>`);

    const [created] = await db
      .insert(comments)
      .values({
        id: `cmt_${crypto.randomUUID()}`,
        chapterId,
        userId: req.actor!.id,
        parentCommentId: parsed.data.parentCommentId || null,
        bodyHtml: cleanHtml,
      })
      .returning();

    if (novel && novel.authorId !== req.actor!.id) {
      await db.insert(notifications).values({
        id: `notif_${crypto.randomUUID()}`,
        userId: novel.authorId,
        type: 'NEW_COMMENT',
        title: `New margin note on ${chapter.title}`,
        message: `${req.actor!.displayName} commented on ${novel.title}.`,
        linkPath: `/novel/${novel.slug}/read/${chapter.id}`,
      });
    }

    res.status(201).json({
      comment: {
        ...created,
        authorName: req.actor!.displayName,
      },
    });
  } catch (error) {
    console.error('POST comment error:', error);
    res.status(500).json({ error: 'Failed to post comment.' });
  }
});

communityRouter.post('/authors/:authorId/follow', async (req: LiteraRequest, res) => {
  try {
    const authorId = Number(req.params.authorId);
    if (!Number.isFinite(authorId) || authorId === req.actor!.id) {
      res.status(400).json({ error: 'Invalid author target.' });
      return;
    }

    await db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(follows)
        .where(and(eq(follows.followerId, req.actor!.id), eq(follows.authorId, authorId)))
        .limit(1);

      if (!existing) {
        await tx.insert(follows).values({ followerId: req.actor!.id, authorId });
        const allF = await tx.select().from(follows).where(eq(follows.authorId, authorId));
        await tx
          .update(authorProfiles)
          .set({ followerCount: allF.length })
          .where(eq(authorProfiles.userId, authorId));

        await tx.insert(notifications).values({
          id: `notif_${crypto.randomUUID()}`,
          userId: authorId,
          type: 'NEW_FOLLOWER',
          title: 'New reader following your works',
          message: `${req.actor!.displayName} started following your publications.`,
          linkPath: `/author/${authorId}`,
        });
      }
    });

    res.json({ following: true });
  } catch (error) {
    console.error('Follow error:', error);
    res.status(500).json({ error: 'Failed to follow author.' });
  }
});

communityRouter.delete('/authors/:authorId/follow', async (req: LiteraRequest, res) => {
  try {
    const authorId = Number(req.params.authorId);
    await db.transaction(async (tx) => {
      await tx
        .delete(follows)
        .where(and(eq(follows.followerId, req.actor!.id), eq(follows.authorId, authorId)));
      const allF = await tx.select().from(follows).where(eq(follows.authorId, authorId));
      await tx
        .update(authorProfiles)
        .set({ followerCount: allF.length })
        .where(eq(authorProfiles.userId, authorId));
    });

    res.json({ following: false });
  } catch (error) {
    console.error('Unfollow error:', error);
    res.status(500).json({ error: 'Failed to unfollow author.' });
  }
});

communityRouter.get('/notifications', async (req: LiteraRequest, res) => {
  try {
    const list = await db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, req.actor!.id))
      .orderBy(desc(notifications.createdAt))
      .limit(30);

    res.json({ notifications: list });
  } catch (error) {
    console.error('GET notifications error:', error);
    res.status(500).json({ error: 'Failed to load notifications.' });
  }
});

communityRouter.post('/notifications/:id/read', async (req: LiteraRequest, res) => {
  try {
    const id = String(req.params.id || '');
    await db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.id, id), eq(notifications.userId, req.actor!.id)));
    res.json({ ok: true });
  } catch (error) {
    console.error('Read notification error:', error);
    res.status(500).json({ error: 'Failed to mark notification read.' });
  }
});

communityRouter.post('/notifications/read-all', async (req: LiteraRequest, res) => {
  try {
    await db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.userId, req.actor!.id), isNull(notifications.readAt)));
    res.json({ ok: true });
  } catch (error) {
    console.error('Read all notifications error:', error);
    res.status(500).json({ error: 'Failed to mark notifications read.' });
  }
});

communityRouter.post('/reports', communityRateLimit, async (req: LiteraRequest, res) => {
  try {
    const parsed = reportSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid report fields.' });
      return;
    }

    const id = `rep_${crypto.randomUUID().slice(0, 10)}`;
    const [created] = await db
      .insert(reports)
      .values({
        id,
        reporterId: req.actor!.id,
        targetType: parsed.data.targetType,
        targetId: parsed.data.targetId,
        reason: parsed.data.reason.trim(),
        details: parsed.data.details.trim(),
        status: 'OPEN',
      })
      .returning();

    await appendLiteraAudit({
      actorId: req.actor!.id,
      actorEmail: req.actor!.email,
      action: 'CONTENT_REPORTED',
      resourceType: parsed.data.targetType,
      resourceId: parsed.data.targetId,
      ip: req.ip,
      metadata: { reportId: id, reason: parsed.data.reason },
    });

    res.status(201).json({ report: created });
  } catch (error) {
    console.error('POST report error:', error);
    res.status(500).json({ error: 'Failed to submit content report.' });
  }
});

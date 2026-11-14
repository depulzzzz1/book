import { Router } from 'express';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import {
  authorProfiles,
  chapters,
  comments,
  follows,
  genres,
  novelGenres,
  novels,
  reviews,
  userProfiles,
} from '../../db/schema.ts';
import { LiteraRequest, optionalAuth } from '../auth.ts';
import { analyzeReadabilityViaPython, scoreRecommendationsViaPython } from '../python-bridge.ts';

export const catalogRouter = Router();

catalogRouter.get('/genres', async (_req, res) => {
  try {
    const list = await db.select().from(genres).orderBy(asc(genres.displayOrder));
    res.json({ genres: list });
  } catch (error) {
    console.error('GET /api/genres error:', error);
    res.status(500).json({ error: 'Failed to fetch genres.' });
  }
});

catalogRouter.get('/novels', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim().toLowerCase();
    const genreSlug = String(req.query.genre || '').trim().toLowerCase();
    const sort = String(req.query.sort || 'featured');
    const completion = String(req.query.completion || '').trim().toUpperCase();

    const publishedNovels = await db
      .select()
      .from(novels)
      .where(eq(novels.status, 'PUBLISHED'))
      .orderBy(
        sort === 'popular'
          ? desc(novels.viewCount)
          : sort === 'rating'
            ? desc(novels.avgRating)
            : sort === 'recent'
              ? desc(novels.publishedAt)
              : asc(novels.featuredRank)
      );

    if (publishedNovels.length === 0) {
      res.json({ novels: [] });
      return;
    }

    const novelIds = publishedNovels.map((n) => n.id);
    const authorIds = [...new Set(publishedNovels.map((n) => n.authorId))];

    const [authorsData, profilesData, ngRows, allGenres] = await Promise.all([
      db.select().from(authorProfiles).where(inArray(authorProfiles.userId, authorIds)),
      db.select().from(userProfiles).where(inArray(userProfiles.userId, authorIds)),
      db.select().from(novelGenres).where(inArray(novelGenres.novelId, novelIds)),
      db.select().from(genres),
    ]);

    const authorMap = new Map(authorsData.map((a) => [a.userId, a]));
    const profileMap = new Map(profilesData.map((p) => [p.userId, p]));
    const genreMap = new Map(allGenres.map((g) => [g.id, g]));

    const genresByNovel = new Map<string, Array<{ id: number; slug: string; name: string }>>();
    for (const row of ngRows) {
      const g = genreMap.get(row.genreId);
      if (!g) continue;
      const arr = genresByNovel.get(row.novelId) || [];
      arr.push({ id: g.id, slug: g.slug, name: g.name });
      genresByNovel.set(row.novelId, arr);
    }

    const enriched = publishedNovels
      .map((n) => {
        const authorProf = authorMap.get(n.authorId);
        const userProf = profileMap.get(n.authorId);
        const novelGenreList = genresByNovel.get(n.id) || [];
        return {
          ...n,
          authorName: authorProf?.penName || userProf?.displayName || 'Litera Author',
          authorVerified: authorProf?.verificationStatus === 'VERIFIED',
          genres: novelGenreList,
        };
      })
      .filter((n) => {
        if (genreSlug && !n.genres.some((g) => g.slug === genreSlug)) {
          return false;
        }
        if (completion && ['ONGOING', 'COMPLETED', 'HIATUS'].includes(completion)) {
          if (n.completionStatus !== completion) return false;
        }
        if (q) {
          const haystack = `${n.title} ${n.subtitle} ${n.synopsis} ${n.authorName}`.toLowerCase();
          if (!haystack.includes(q)) return false;
        }
        return true;
      });

    res.json({ novels: enriched });
  } catch (error) {
    console.error('GET /api/novels error:', error);
    res.status(500).json({ error: 'Failed to load catalog.' });
  }
});

catalogRouter.get('/novels/:slug', optionalAuth, async (req: LiteraRequest, res) => {
  try {
    const slug = String(req.params.slug || '');
    const [novel] = await db.select().from(novels).where(eq(novels.slug, slug)).limit(1);

    if (!novel) {
      res.status(404).json({ error: 'Novel not found.' });
      return;
    }

    const canViewUnpublished =
      req.actor &&
      (req.actor.id === novel.authorId || req.actor.role === 'ADMIN' || req.actor.role === 'EDITOR');

    if (novel.status !== 'PUBLISHED' && !canViewUnpublished) {
      res.status(404).json({ error: 'Novel not found.' });
      return;
    }

    const [authorProf] = await db
      .select()
      .from(authorProfiles)
      .where(eq(authorProfiles.userId, novel.authorId))
      .limit(1);

    const [userProf] = await db
      .select()
      .from(userProfiles)
      .where(eq(userProfiles.userId, novel.authorId))
      .limit(1);

    const genreRows = await db
      .select({ id: genres.id, slug: genres.slug, name: genres.name })
      .from(novelGenres)
      .innerJoin(genres, eq(novelGenres.genreId, genres.id))
      .where(eq(novelGenres.novelId, novel.id));

    const chapterCondition = canViewUnpublished
      ? eq(chapters.novelId, novel.id)
      : and(eq(chapters.novelId, novel.id), eq(chapters.status, 'PUBLISHED'));

    const chapterList = await db
      .select({
        id: chapters.id,
        novelId: chapters.novelId,
        chapterNumber: chapters.chapterNumber,
        title: chapters.title,
        slug: chapters.slug,
        status: chapters.status,
        plainExcerpt: chapters.plainExcerpt,
        wordCount: chapters.wordCount,
        readingMinutes: chapters.readingMinutes,
        publishedAt: chapters.publishedAt,
      })
      .from(chapters)
      .where(chapterCondition)
      .orderBy(asc(chapters.chapterNumber));

    const reviewRows = await db
      .select({
        id: reviews.id,
        userId: reviews.userId,
        novelId: reviews.novelId,
        rating: reviews.rating,
        title: reviews.title,
        body: reviews.body,
        helpfulCount: reviews.helpfulCount,
        createdAt: reviews.createdAt,
        reviewerName: userProfiles.displayName,
      })
      .from(reviews)
      .leftJoin(userProfiles, eq(reviews.userId, userProfiles.userId))
      .where(and(eq(reviews.novelId, novel.id), eq(reviews.status, 'PUBLISHED')))
      .orderBy(desc(reviews.createdAt));

    let isFollowing = false;
    if (req.actor) {
      const [f] = await db
        .select()
        .from(follows)
        .where(and(eq(follows.followerId, req.actor.id), eq(follows.authorId, novel.authorId)))
        .limit(1);
      isFollowing = Boolean(f);
    }

    // Compute Python-scored reading recommendations
    const otherPublished = await db
      .select()
      .from(novels)
      .where(eq(novels.status, 'PUBLISHED'))
      .limit(20);

    const otherIds = otherPublished.map((o) => o.id);
    const otherNg = otherIds.length
      ? await db
          .select({ novelId: novelGenres.novelId, slug: genres.slug })
          .from(novelGenres)
          .innerJoin(genres, eq(novelGenres.genreId, genres.id))
          .where(inArray(novelGenres.novelId, otherIds))
      : [];

    const otherGenreMap = new Map<string, string[]>();
    for (const row of otherNg) {
      const arr = otherGenreMap.get(row.novelId) || [];
      arr.push(row.slug);
      otherGenreMap.set(row.novelId, arr);
    }

    let recommendations: Array<{
      id: string;
      slug: string;
      title: string;
      coverUrl: string;
      avgRating: number;
      recommendation_score?: number;
    }> = [];

    try {
      const pyRecs = await scoreRecommendationsViaPython({
        target_novel_id: novel.id,
        target_genres: genreRows.map((g) => g.slug),
        candidates: otherPublished.map((o) => ({
          id: o.id,
          genres: otherGenreMap.get(o.id) || [],
          avg_rating: o.avgRating,
          view_count: o.viewCount,
        })),
        limit: 3,
      });

      const recScoreMap = new Map(pyRecs.recommendations.map((r) => [r.id, r.recommendation_score]));
      recommendations = otherPublished
        .filter((o) => recScoreMap.has(o.id))
        .map((o) => ({
          id: o.id,
          slug: o.slug,
          title: o.title,
          coverUrl: o.coverUrl,
          avgRating: o.avgRating,
          recommendation_score: recScoreMap.get(o.id),
        }))
        .sort((a, b) => (b.recommendation_score || 0) - (a.recommendation_score || 0));
    } catch {
      recommendations = otherPublished
        .filter((o) => o.id !== novel.id)
        .slice(0, 3)
        .map((o) => ({
          id: o.id,
          slug: o.slug,
          title: o.title,
          coverUrl: o.coverUrl,
          avgRating: o.avgRating,
        }));
    }

    res.json({
      novel: {
        ...novel,
        genres: genreRows,
      },
      author: {
        userId: novel.authorId,
        penName: authorProf?.penName || userProf?.displayName || 'Litera Author',
        biography: authorProf?.biography || userProf?.bio || '',
        verificationStatus: authorProf?.verificationStatus || 'UNVERIFIED',
        followerCount: authorProf?.followerCount || 0,
        isFollowing,
      },
      chapters: chapterList,
      reviews: reviewRows,
      recommendations,
    });
  } catch (error) {
    console.error('GET /api/novels/:slug error:', error);
    res.status(500).json({ error: 'Failed to load novel detail.' });
  }
});

catalogRouter.get('/novels/:slug/chapters/:chapterId', optionalAuth, async (req: LiteraRequest, res) => {
  try {
    const slug = String(req.params.slug || '');
    const chapterId = String(req.params.chapterId || '');

    const [novel] = await db.select().from(novels).where(eq(novels.slug, slug)).limit(1);
    if (!novel) {
      res.status(404).json({ error: 'Novel not found.' });
      return;
    }

    const canViewUnpublished =
      req.actor &&
      (req.actor.id === novel.authorId || req.actor.role === 'ADMIN' || req.actor.role === 'EDITOR');

    if (novel.status !== 'PUBLISHED' && !canViewUnpublished) {
      res.status(404).json({ error: 'Novel not found.' });
      return;
    }

    const [chapter] = await db
      .select()
      .from(chapters)
      .where(and(eq(chapters.id, chapterId), eq(chapters.novelId, novel.id)))
      .limit(1);

    if (!chapter || (chapter.status !== 'PUBLISHED' && !canViewUnpublished)) {
      res.status(404).json({ error: 'Chapter not available.' });
      return;
    }

    // Increment view counter for published reads
    if (chapter.status === 'PUBLISHED') {
      await db
        .update(novels)
        .set({ viewCount: novel.viewCount + 1 })
        .where(eq(novels.id, novel.id));
    }

    const siblingCondition = canViewUnpublished
      ? eq(chapters.novelId, novel.id)
      : and(eq(chapters.novelId, novel.id), eq(chapters.status, 'PUBLISHED'));

    const allChapters = await db
      .select({
        id: chapters.id,
        chapterNumber: chapters.chapterNumber,
        title: chapters.title,
        status: chapters.status,
      })
      .from(chapters)
      .where(siblingCondition)
      .orderBy(asc(chapters.chapterNumber));

    const idx = allChapters.findIndex((c) => c.id === chapter.id);
    const prevChapter = idx > 0 ? allChapters[idx - 1] : null;
    const nextChapter = idx >= 0 && idx < allChapters.length - 1 ? allChapters[idx + 1] : null;

    const commentRows = await db
      .select({
        id: comments.id,
        chapterId: comments.chapterId,
        userId: comments.userId,
        parentCommentId: comments.parentCommentId,
        bodyHtml: comments.bodyHtml,
        createdAt: comments.createdAt,
        authorName: userProfiles.displayName,
      })
      .from(comments)
      .leftJoin(userProfiles, eq(comments.userId, userProfiles.userId))
      .where(and(eq(comments.chapterId, chapter.id), eq(comments.status, 'VISIBLE')))
      .orderBy(asc(comments.createdAt));

    let readability = null;
    try {
      readability = await analyzeReadabilityViaPython(chapter.contentHtml);
    } catch {
      readability = null;
    }

    res.json({
      novel: {
        id: novel.id,
        slug: novel.slug,
        title: novel.title,
        authorId: novel.authorId,
      },
      chapter,
      prevChapter,
      nextChapter,
      allChapters,
      comments: commentRows,
      readability,
    });
  } catch (error) {
    console.error('GET chapter error:', error);
    res.status(500).json({ error: 'Failed to load chapter.' });
  }
});

catalogRouter.get('/authors/:userId', optionalAuth, async (req: LiteraRequest, res) => {
  try {
    const authorUserId = Number(req.params.userId);
    if (!Number.isFinite(authorUserId)) {
      res.status(400).json({ error: 'Invalid author identifier.' });
      return;
    }

    const [authorProf] = await db
      .select()
      .from(authorProfiles)
      .where(eq(authorProfiles.userId, authorUserId))
      .limit(1);

    const [userProf] = await db
      .select()
      .from(userProfiles)
      .where(eq(userProfiles.userId, authorUserId))
      .limit(1);

    if (!authorProf && !userProf) {
      res.status(404).json({ error: 'Author not found.' });
      return;
    }

    const publishedNovels = await db
      .select()
      .from(novels)
      .where(and(eq(novels.authorId, authorUserId), eq(novels.status, 'PUBLISHED')))
      .orderBy(desc(novels.publishedAt));

    let isFollowing = false;
    if (req.actor) {
      const [f] = await db
        .select()
        .from(follows)
        .where(and(eq(follows.followerId, req.actor.id), eq(follows.authorId, authorUserId)))
        .limit(1);
      isFollowing = Boolean(f);
    }

    res.json({
      author: {
        userId: authorUserId,
        penName: authorProf?.penName || userProf?.displayName || 'Litera Author',
        biography: authorProf?.biography || userProf?.bio || '',
        websiteUrl: authorProf?.websiteUrl || '',
        verificationStatus: authorProf?.verificationStatus || 'UNVERIFIED',
        followerCount: authorProf?.followerCount || 0,
        isFollowing,
      },
      novels: publishedNovels,
    });
  } catch (error) {
    console.error('GET /api/authors/:userId error:', error);
    res.status(500).json({ error: 'Failed to load author dossier.' });
  }
});

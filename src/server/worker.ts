import crypto from 'crypto';
import { and, eq, lte } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { chapters, follows, notifications, novels, publicationEvents } from '../db/schema.ts';
import { appendLiteraAudit } from './security.ts';

export async function processDuePublicationEvents() {
  try {
    const now = new Date();
    const dueEvents = await db
      .select()
      .from(publicationEvents)
      .where(
        and(
          eq(publicationEvents.status, 'PENDING'),
          eq(publicationEvents.eventType, 'SCHEDULE_CHAPTER'),
          lte(publicationEvents.scheduledFor, now)
        )
      )
      .limit(10);

    for (const evt of dueEvents) {
      if (!evt.chapterId) continue;

      await db.transaction(async (tx) => {
        const [locked] = await tx
          .update(publicationEvents)
          .set({ status: 'PROCESSING' })
          .where(and(eq(publicationEvents.id, evt.id), eq(publicationEvents.status, 'PENDING')))
          .returning();

        if (!locked) return;

        const [ch] = await tx
          .update(chapters)
          .set({ status: 'PUBLISHED', publishedAt: now, updatedAt: now })
          .where(eq(chapters.id, evt.chapterId!))
          .returning();

        const [novel] = await tx
          .select()
          .from(novels)
          .where(eq(novels.id, evt.novelId))
          .limit(1);

        if (ch && novel && novel.status === 'PUBLISHED') {
          const followerRows = await tx
            .select({ followerId: follows.followerId })
            .from(follows)
            .where(eq(follows.authorId, novel.authorId));

          for (const f of followerRows) {
            await tx.insert(notifications).values({
              id: `notif_${crypto.randomUUID()}`,
              userId: f.followerId,
              type: 'NEW_CHAPTER',
              title: `Scheduled chapter released: ${novel.title}`,
              message: `Chapter ${ch.chapterNumber}: ${ch.title} is now available.`,
              linkPath: `/novel/${novel.slug}/read/${ch.id}`,
            });
          }
        }

        await tx
          .update(publicationEvents)
          .set({ status: 'PUBLISHED', processedAt: now })
          .where(eq(publicationEvents.id, evt.id));
      });

      await appendLiteraAudit({
        actorEmail: 'scheduler@litera.press',
        action: 'SCHEDULED_CHAPTER_PUBLISHED',
        resourceType: 'CHAPTER',
        resourceId: evt.chapterId,
        metadata: { publicationEventId: evt.id },
      });
    }
  } catch (err) {
    console.error('Publication scheduler error:', err);
  }
}

import crypto from 'crypto';
import { Router } from 'express';
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../db/index.ts';
import {
  auditLogs,
  authorProfiles,
  comments,
  moderationActions,
  notifications,
  novels,
  permissions,
  publicationEvents,
  reports,
  reviews,
  rolePermissions,
  roles,
  systemConfigs,
  userProfiles,
  userSessions,
  users,
} from '../../db/schema.ts';
import { LiteraRequest, requireAuth, requireRole } from '../auth.ts';
import { appendLiteraAudit } from '../security.ts';

export const adminRouter = Router();
adminRouter.use(requireAuth, requireRole('EDITOR', 'ADMIN'));

adminRouter.get('/overview', async (_req: LiteraRequest, res) => {
  try {
    const [
      allUsers,
      allNovels,
      openReports,
      pendingAuthors,
      recentAudits,
      configs,
      recentModActions,
    ] = await Promise.all([
      db.select({ id: users.id, role: users.role, isActive: users.isActive }).from(users),
      db.select({ id: novels.id, status: novels.status, viewCount: novels.viewCount, totalWords: novels.totalWords }).from(novels),
      db.select().from(reports).where(eq(reports.status, 'OPEN')).orderBy(desc(reports.createdAt)),
      db
        .select({
          userId: authorProfiles.userId,
          penName: authorProfiles.penName,
          biography: authorProfiles.biography,
          websiteUrl: authorProfiles.websiteUrl,
          verificationStatus: authorProfiles.verificationStatus,
          createdAt: authorProfiles.createdAt,
        })
        .from(authorProfiles)
        .where(eq(authorProfiles.verificationStatus, 'PENDING')),
      db.select().from(auditLogs).orderBy(desc(auditLogs.id)).limit(40),
      db.select().from(systemConfigs),
      db.select().from(moderationActions).orderBy(desc(moderationActions.createdAt)).limit(20),
    ]);

    const pendingNovels = await db
      .select({
        id: novels.id,
        title: novels.title,
        slug: novels.slug,
        synopsis: novels.synopsis,
        status: novels.status,
        authorId: novels.authorId,
        createdAt: novels.createdAt,
        authorName: userProfiles.displayName,
      })
      .from(novels)
      .leftJoin(userProfiles, eq(novels.authorId, userProfiles.userId))
      .where(eq(novels.status, 'PENDING_REVIEW'))
      .orderBy(desc(novels.updatedAt));

    res.json({
      analytics: {
        totalUsers: allUsers.length,
        activeUsers: allUsers.filter((u) => u.isActive).length,
        totalNovels: allNovels.length,
        publishedNovels: allNovels.filter((n) => n.status === 'PUBLISHED').length,
        pendingReviewNovels: pendingNovels.length,
        openReports: openReports.length,
        pendingAuthorVerifications: pendingAuthors.length,
        totalCatalogViews: allNovels.reduce((s, n) => s + n.viewCount, 0),
        totalPublishedWords: allNovels
          .filter((n) => n.status === 'PUBLISHED')
          .reduce((s, n) => s + n.totalWords, 0),
      },
      pendingNovels,
      pendingAuthors,
      openReports,
      recentModActions,
      recentAudits,
      configs,
    });
  } catch (error) {
    console.error('GET /api/admin/overview error:', error);
    res.status(500).json({ error: 'Failed to load administrative overview.' });
  }
});

adminRouter.post('/novels/:id/decision', async (req: LiteraRequest, res) => {
  try {
    const novelId = String(req.params.id || '');
    const schema = z.object({
      decision: z.enum(['APPROVE', 'REJECT']),
      rationale: z.string().min(3).max(500).default('Editorial review completed.'),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid editorial decision.' });
      return;
    }

    const [novel] = await db.select().from(novels).where(eq(novels.id, novelId)).limit(1);
    if (!novel) {
      res.status(404).json({ error: 'Novel not found.' });
      return;
    }

    const nextStatus = parsed.data.decision === 'APPROVE' ? 'PUBLISHED' : 'REJECTED';
    const updated = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(novels)
        .set({
          status: nextStatus,
          publishedAt: nextStatus === 'PUBLISHED' ? novel.publishedAt || new Date() : null,
          version: novel.version + 1,
          updatedAt: new Date(),
        })
        .where(eq(novels.id, novelId))
        .returning();

      await tx.insert(moderationActions).values({
        id: `mod_${crypto.randomUUID().slice(0, 10)}`,
        moderatorId: req.actor!.id,
        actionType: parsed.data.decision === 'APPROVE' ? 'APPROVE_NOVEL' : 'REJECT_NOVEL',
        targetType: 'NOVEL',
        targetId: novelId,
        rationale: parsed.data.rationale,
      });

      await tx.insert(publicationEvents).values({
        id: `pub_${crypto.randomUUID()}`,
        novelId,
        eventType: parsed.data.decision === 'APPROVE' ? 'APPROVE_NOVEL' : 'REJECT_NOVEL',
        scheduledFor: new Date(),
        status: 'PUBLISHED',
        idempotencyKey: `decision-${novelId}-v${novel.version + 1}`,
        processedAt: new Date(),
      });

      await tx.insert(notifications).values({
        id: `notif_${crypto.randomUUID()}`,
        userId: novel.authorId,
        type: 'EDITORIAL_DECISION',
        title:
          nextStatus === 'PUBLISHED'
            ? `"${novel.title}" approved for catalog`
            : `Editorial revision requested for "${novel.title}"`,
        message: parsed.data.rationale,
        linkPath: nextStatus === 'PUBLISHED' ? `/novel/${novel.slug}` : '/studio',
      });

      return row;
    });

    await appendLiteraAudit({
      actorId: req.actor!.id,
      actorEmail: req.actor!.email,
      action: parsed.data.decision === 'APPROVE' ? 'NOVEL_APPROVED' : 'NOVEL_REJECTED',
      resourceType: 'NOVEL',
      resourceId: novelId,
      ip: req.ip,
      metadata: { rationale: parsed.data.rationale },
    });

    res.json({ novel: updated });
  } catch (error) {
    console.error('Novel decision error:', error);
    res.status(500).json({ error: 'Failed to process editorial decision.' });
  }
});

adminRouter.post('/authors/:userId/verify', async (req: LiteraRequest, res) => {
  try {
    const targetUserId = Number(req.params.userId);
    const schema = z.object({
      status: z.enum(['VERIFIED', 'REJECTED']),
      note: z.string().max(400).default(''),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success || !Number.isFinite(targetUserId)) {
      res.status(400).json({ error: 'Invalid verification payload.' });
      return;
    }

    const [updated] = await db
      .update(authorProfiles)
      .set({
        verificationStatus: parsed.data.status,
        verificationNote: parsed.data.note,
        verifiedAt: parsed.data.status === 'VERIFIED' ? new Date() : null,
        verifiedBy: req.actor!.id,
        updatedAt: new Date(),
      })
      .where(eq(authorProfiles.userId, targetUserId))
      .returning();

    if (!updated) {
      res.status(404).json({ error: 'Author profile not found.' });
      return;
    }

    await db.insert(notifications).values({
      id: `notif_${crypto.randomUUID()}`,
      userId: targetUserId,
      type: 'AUTHOR_VERIFICATION',
      title:
        parsed.data.status === 'VERIFIED'
          ? 'Author verification granted'
          : 'Author verification requires update',
      message: parsed.data.note || `Status updated to ${parsed.data.status}.`,
      linkPath: '/studio',
    });

    await appendLiteraAudit({
      actorId: req.actor!.id,
      actorEmail: req.actor!.email,
      action: 'AUTHOR_VERIFICATION_DECIDED',
      resourceType: 'AUTHOR_PROFILE',
      resourceId: String(targetUserId),
      ip: req.ip,
      metadata: { status: parsed.data.status },
    });

    res.json({ authorProfile: updated });
  } catch (error) {
    console.error('Verify author error:', error);
    res.status(500).json({ error: 'Failed to verify author.' });
  }
});

adminRouter.post('/reports/:id/resolve', async (req: LiteraRequest, res) => {
  try {
    const reportId = String(req.params.id || '');
    const schema = z.object({
      action: z.enum(['HIDE_CONTENT', 'DISMISS']),
      rationale: z.string().min(3).max(500),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid moderation resolution.' });
      return;
    }

    const [report] = await db.select().from(reports).where(eq(reports.id, reportId)).limit(1);
    if (!report) {
      res.status(404).json({ error: 'Report not found.' });
      return;
    }

    await db.transaction(async (tx) => {
      if (parsed.data.action === 'HIDE_CONTENT') {
        if (report.targetType === 'COMMENT') {
          await tx.update(comments).set({ status: 'HIDDEN' }).where(eq(comments.id, report.targetId));
        } else if (report.targetType === 'REVIEW') {
          await tx.update(reviews).set({ status: 'HIDDEN' }).where(eq(reviews.id, report.targetId));
        } else if (report.targetType === 'NOVEL') {
          await tx.update(novels).set({ status: 'ARCHIVED' }).where(eq(novels.id, report.targetId));
        }
      }

      await tx
        .update(reports)
        .set({
          status: parsed.data.action === 'DISMISS' ? 'DISMISSED' : 'RESOLVED',
          updatedAt: new Date(),
        })
        .where(eq(reports.id, reportId));

      await tx.insert(moderationActions).values({
        id: `mod_${crypto.randomUUID().slice(0, 10)}`,
        reportId,
        moderatorId: req.actor!.id,
        actionType: parsed.data.action,
        targetType: report.targetType,
        targetId: report.targetId,
        rationale: parsed.data.rationale,
      });
    });

    await appendLiteraAudit({
      actorId: req.actor!.id,
      actorEmail: req.actor!.email,
      action: 'REPORT_MODERATED',
      resourceType: 'REPORT',
      resourceId: reportId,
      ip: req.ip,
      metadata: { action: parsed.data.action },
    });

    res.json({ resolved: true });
  } catch (error) {
    console.error('Resolve report error:', error);
    res.status(500).json({ error: 'Failed to resolve report.' });
  }
});

adminRouter.get('/users', requireRole('ADMIN'), async (_req, res) => {
  try {
    const rows = await db
      .select({
        id: users.id,
        email: users.email,
        role: users.role,
        authProvider: users.authProvider,
        isActive: users.isActive,
        createdAt: users.createdAt,
        displayName: userProfiles.displayName,
      })
      .from(users)
      .leftJoin(userProfiles, eq(users.id, userProfiles.userId))
      .orderBy(desc(users.createdAt))
      .limit(100);

    res.json({ users: rows });
  } catch (error) {
    console.error('GET /api/admin/users error:', error);
    res.status(500).json({ error: 'Failed to fetch users.' });
  }
});

adminRouter.patch('/users/:id/role', requireRole('ADMIN'), async (req: LiteraRequest, res) => {
  try {
    const targetId = Number(req.params.id);
    const schema = z.object({
      role: z.enum(['READER', 'AUTHOR', 'EDITOR', 'ADMIN']),
      isActive: z.boolean().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success || !Number.isFinite(targetId)) {
      res.status(400).json({ error: 'Invalid user role update.' });
      return;
    }

    const [updated] = await db
      .update(users)
      .set({
        role: parsed.data.role,
        ...(parsed.data.isActive !== undefined ? { isActive: parsed.data.isActive } : {}),
        updatedAt: new Date(),
      })
      .where(eq(users.id, targetId))
      .returning();

    if (!updated) {
      res.status(404).json({ error: 'User not found.' });
      return;
    }

    if (parsed.data.isActive === false) {
      await db
        .update(userSessions)
        .set({ revokedAt: new Date() })
        .where(eq(userSessions.userId, targetId));
    }

    await appendLiteraAudit({
      actorId: req.actor!.id,
      actorEmail: req.actor!.email,
      action: 'USER_ROLE_UPDATED',
      resourceType: 'USER',
      resourceId: String(targetId),
      ip: req.ip,
      metadata: { role: parsed.data.role, isActive: updated.isActive },
    });

    res.json({ user: updated });
  } catch (error) {
    console.error('PATCH admin user role error:', error);
    res.status(500).json({ error: 'Failed to update user role.' });
  }
});

adminRouter.get('/permissions', requireRole('ADMIN'), async (_req, res) => {
  try {
    const [allRoles, allPerms, mappings] = await Promise.all([
      db.select().from(roles),
      db.select().from(permissions),
      db.select().from(rolePermissions),
    ]);
    res.json({ roles: allRoles, permissions: allPerms, rolePermissions: mappings });
  } catch (error) {
    console.error('GET permissions error:', error);
    res.status(500).json({ error: 'Failed to load RBAC matrix.' });
  }
});

adminRouter.put('/configs/:key', requireRole('ADMIN'), async (req: LiteraRequest, res) => {
  try {
    const key = String(req.params.key || '');
    const valueJson = JSON.stringify(req.body?.value);
    const [updated] = await db
      .insert(systemConfigs)
      .values({
        key,
        valueJson,
        description: String(req.body?.description || ''),
        updatedBy: req.actor!.id,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: systemConfigs.key,
        set: {
          valueJson,
          updatedBy: req.actor!.id,
          updatedAt: new Date(),
        },
      })
      .returning();

    await appendLiteraAudit({
      actorId: req.actor!.id,
      actorEmail: req.actor!.email,
      action: 'SYSTEM_CONFIG_UPDATED',
      resourceType: 'SYSTEM_CONFIG',
      resourceId: key,
      ip: req.ip,
      metadata: { valueJson },
    });

    res.json({ config: updated });
  } catch (error) {
    console.error('PUT config error:', error);
    res.status(500).json({ error: 'Failed to update system configuration.' });
  }
});

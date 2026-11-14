import crypto from 'crypto';
import { Router } from 'express';
import { and, desc, eq, isNull, ne } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../db/index.ts';
import {
  authorProfiles,
  notifications,
  passwordResetTokens,
  userProfiles,
  userSessions,
  users,
} from '../../db/schema.ts';
import {
  clearSessionCookies,
  createUserSession,
  LiteraRequest,
  loadActorByUserId,
  optionalAuth,
  requireAuth,
} from '../auth.ts';
import {
  appendLiteraAudit,
  createRateLimiter,
  generateOpaqueToken,
  hashPasswordArgon2id,
  hashTokenSha256,
  verifyPasswordArgon2id,
} from '../security.ts';

export const authRouter = Router();

const authRateLimit = createRateLimiter({
  windowMs: 60_000,
  maxRequests: 25,
  keyPrefix: 'auth',
});

const registerSchema = z.object({
  email: z.string().email().max(180),
  password: z.string().min(8).max(128),
  displayName: z.string().min(2).max(80),
  accountType: z.enum(['reader', 'author']).default('reader'),
  penName: z.string().min(2).max(80).optional(),
});

const loginSchema = z.object({
  email: z.string().email().max(180),
  password: z.string().min(1).max(128),
});

const profileUpdateSchema = z.object({
  displayName: z.string().min(2).max(80).optional(),
  bio: z.string().max(600).optional(),
  preferredTheme: z.enum(['ivory', 'sepia', 'dark']).optional(),
  preferredFont: z.enum(['serif', 'sans']).optional(),
  preferredFontSize: z.number().int().min(14).max(28).optional(),
  preferredLineHeight: z.number().min(1.3).max(2.3).optional(),
});

const authorProfileSchema = z.object({
  penName: z.string().min(2).max(80),
  biography: z.string().max(1500).default(''),
  websiteUrl: z.string().max(240).default(''),
  requestVerification: z.boolean().default(false),
});

authRouter.post('/register', authRateLimit, async (req, res) => {
  try {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid registration fields.', details: parsed.error.flatten() });
      return;
    }

    const email = parsed.data.email.trim().toLowerCase();
    const [existing] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (existing) {
      res.status(409).json({ error: 'An account with this email already exists.' });
      return;
    }

    const passwordHash = await hashPasswordArgon2id(parsed.data.password);
    const assignedRole = parsed.data.accountType === 'author' ? 'AUTHOR' : 'READER';
    const uid = `litera_${crypto.randomUUID()}`;

    const createdUser = await db.transaction(async (tx) => {
      const [u] = await tx
        .insert(users)
        .values({
          uid,
          email,
          role: assignedRole,
          tenantId: 'litera-public',
          passwordHash,
          authProvider: 'LOCAL',
          isActive: true,
          isVerified: true,
        })
        .returning();

      if (!u) throw new Error('Failed to create user record.');

      await tx.insert(userProfiles).values({
        userId: u.id,
        displayName: parsed.data.displayName.trim(),
        bio: '',
      });

      if (assignedRole === 'AUTHOR') {
        await tx.insert(authorProfiles).values({
          userId: u.id,
          penName: (parsed.data.penName || parsed.data.displayName).trim(),
          biography: '',
          verificationStatus: 'PENDING',
        });
      }

      return u;
    });

    const session = await createUserSession(createdUser.id, req, res);
    const actor = await loadActorByUserId(createdUser.id, session.sessionId);

    await appendLiteraAudit({
      actorId: createdUser.id,
      actorEmail: email,
      action: 'USER_REGISTERED',
      resourceType: 'USER',
      resourceId: String(createdUser.id),
      ip: req.ip,
      metadata: { role: assignedRole },
    });

    res.status(201).json({
      user: actor,
      sessionToken: session.rawToken,
      csrfToken: session.csrfToken,
    });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ error: 'Registration failed. Please try again.' });
  }
});

authRouter.post('/login', authRateLimit, async (req, res) => {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Valid email and password are required.' });
      return;
    }

    const email = parsed.data.email.trim().toLowerCase();
    const [userRow] = await db
      .select()
      .from(users)
      .where(and(eq(users.email, email), isNull(users.deletedAt)))
      .limit(1);

    if (!userRow || !userRow.passwordHash) {
      res.status(401).json({ error: 'Invalid email or password.' });
      return;
    }

    if (!userRow.isActive) {
      res.status(403).json({ error: 'This account has been suspended by an administrator.' });
      return;
    }

    const valid = await verifyPasswordArgon2id(parsed.data.password, userRow.passwordHash);
    if (!valid) {
      await appendLiteraAudit({
        actorId: userRow.id,
        actorEmail: email,
        action: 'LOGIN_FAILED',
        resourceType: 'USER',
        resourceId: String(userRow.id),
        ip: req.ip,
      });
      res.status(401).json({ error: 'Invalid email or password.' });
      return;
    }

    const session = await createUserSession(userRow.id, req, res);
    const actor = await loadActorByUserId(userRow.id, session.sessionId);

    await appendLiteraAudit({
      actorId: userRow.id,
      actorEmail: email,
      action: 'LOGIN_SUCCEEDED',
      resourceType: 'USER_SESSION',
      resourceId: session.sessionId,
      ip: req.ip,
    });

    res.json({
      user: actor,
      sessionToken: session.rawToken,
      csrfToken: session.csrfToken,
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Sign in failed.' });
  }
});

authRouter.post('/logout', optionalAuth, async (req: LiteraRequest, res) => {
  try {
    if (req.actor?.sessionId) {
      await db
        .update(userSessions)
        .set({ revokedAt: new Date() })
        .where(eq(userSessions.id, req.actor.sessionId));

      await appendLiteraAudit({
        actorId: req.actor.id,
        actorEmail: req.actor.email,
        action: 'SESSION_LOGOUT',
        resourceType: 'USER_SESSION',
        resourceId: req.actor.sessionId,
        ip: req.ip,
      });
    }
    clearSessionCookies(res);
    res.json({ ok: true });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ error: 'Failed to sign out.' });
  }
});

authRouter.get('/me', optionalAuth, async (req: LiteraRequest, res) => {
  try {
    if (!req.actor) {
      res.json({ user: null, profile: null, authorProfile: null, unreadNotifications: 0 });
      return;
    }

    const [profile] = await db
      .select()
      .from(userProfiles)
      .where(eq(userProfiles.userId, req.actor.id))
      .limit(1);

    const [authorProfile] = await db
      .select()
      .from(authorProfiles)
      .where(eq(authorProfiles.userId, req.actor.id))
      .limit(1);

    const unreadRows = await db
      .select({ id: notifications.id })
      .from(notifications)
      .where(and(eq(notifications.userId, req.actor.id), isNull(notifications.readAt)));

    res.json({
      user: req.actor,
      profile: profile || null,
      authorProfile: authorProfile || null,
      unreadNotifications: unreadRows.length,
    });
  } catch (error) {
    console.error('GET /api/auth/me error:', error);
    res.status(500).json({ error: 'Failed to retrieve account state.' });
  }
});

authRouter.get('/sessions', requireAuth, async (req: LiteraRequest, res) => {
  try {
    const rows = await db
      .select({
        id: userSessions.id,
        userAgent: userSessions.userAgent,
        expiresAt: userSessions.expiresAt,
        revokedAt: userSessions.revokedAt,
        createdAt: userSessions.createdAt,
      })
      .from(userSessions)
      .where(eq(userSessions.userId, req.actor!.id))
      .orderBy(desc(userSessions.createdAt))
      .limit(20);

    res.json({
      currentSessionId: req.actor!.sessionId || null,
      sessions: rows,
    });
  } catch (error) {
    console.error('Sessions list error:', error);
    res.status(500).json({ error: 'Failed to load active sessions.' });
  }
});

authRouter.delete('/sessions/:sessionId', requireAuth, async (req: LiteraRequest, res) => {
  try {
    const sessionId = String(req.params.sessionId || '');
    const [updated] = await db
      .update(userSessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(userSessions.id, sessionId), eq(userSessions.userId, req.actor!.id)))
      .returning();

    if (!updated) {
      res.status(404).json({ error: 'Session not found.' });
      return;
    }

    await appendLiteraAudit({
      actorId: req.actor!.id,
      actorEmail: req.actor!.email,
      action: 'SESSION_REVOKED',
      resourceType: 'USER_SESSION',
      resourceId: sessionId,
      ip: req.ip,
    });

    res.json({ revoked: true, sessionId });
  } catch (error) {
    console.error('Revoke session error:', error);
    res.status(500).json({ error: 'Failed to revoke session.' });
  }
});

authRouter.post('/sessions/revoke-all', requireAuth, async (req: LiteraRequest, res) => {
  try {
    const currentId = req.actor!.sessionId;
    if (currentId) {
      await db
        .update(userSessions)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(userSessions.userId, req.actor!.id),
            ne(userSessions.id, currentId),
            isNull(userSessions.revokedAt)
          )
        );
    } else {
      await db
        .update(userSessions)
        .set({ revokedAt: new Date() })
        .where(and(eq(userSessions.userId, req.actor!.id), isNull(userSessions.revokedAt)));
    }

    await appendLiteraAudit({
      actorId: req.actor!.id,
      actorEmail: req.actor!.email,
      action: 'ALL_OTHER_SESSIONS_REVOKED',
      resourceType: 'USER',
      resourceId: String(req.actor!.id),
      ip: req.ip,
    });

    res.json({ ok: true });
  } catch (error) {
    console.error('Revoke all sessions error:', error);
    res.status(500).json({ error: 'Failed to revoke sessions.' });
  }
});

authRouter.post('/password-reset/request', authRateLimit, async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!email) {
      res.status(400).json({ error: 'Email is required.' });
      return;
    }

    const [userRow] = await db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    let devToken: string | undefined;
    if (userRow) {
      const rawToken = generateOpaqueToken();
      await db.insert(passwordResetTokens).values({
        id: `rst_${crypto.randomUUID()}`,
        userId: userRow.id,
        tokenHash: hashTokenSha256(rawToken),
        expiresAt: new Date(Date.now() + 1000 * 60 * 30),
      });

      await appendLiteraAudit({
        actorId: userRow.id,
        actorEmail: userRow.email,
        action: 'PASSWORD_RESET_REQUESTED',
        resourceType: 'USER',
        resourceId: String(userRow.id),
        ip: req.ip,
      });

      if (process.env.LITERA_EXPOSE_DEV_RESET === 'true') {
        devToken = rawToken;
      }
    }

    res.json({
      message: 'If an account matches that address, password recovery instructions have been issued.',
      ...(devToken ? { recoveryTokenPreview: devToken } : {}),
    });
  } catch (error) {
    console.error('Password reset request error:', error);
    res.status(500).json({ error: 'Failed to process password recovery request.' });
  }
});

authRouter.post('/password-reset/confirm', authRateLimit, async (req, res) => {
  try {
    const schema = z.object({
      token: z.string().min(10),
      newPassword: z.string().min(8).max(128),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Valid reset token and password (min 8 chars) required.' });
      return;
    }

    const tokenHash = hashTokenSha256(parsed.data.token);
    const [resetRow] = await db
      .select()
      .from(passwordResetTokens)
      .where(and(eq(passwordResetTokens.tokenHash, tokenHash), isNull(passwordResetTokens.usedAt)))
      .limit(1);

    if (!resetRow || resetRow.expiresAt.getTime() < Date.now()) {
      res.status(400).json({ error: 'Recovery token is invalid or expired.' });
      return;
    }

    const newHash = await hashPasswordArgon2id(parsed.data.newPassword);
    await db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({ passwordHash: newHash, updatedAt: new Date() })
        .where(eq(users.id, resetRow.userId));
      await tx
        .update(passwordResetTokens)
        .set({ usedAt: new Date() })
        .where(eq(passwordResetTokens.id, resetRow.id));
      await tx
        .update(userSessions)
        .set({ revokedAt: new Date() })
        .where(eq(userSessions.userId, resetRow.userId));
    });

    await appendLiteraAudit({
      actorId: resetRow.userId,
      actorEmail: 'password-recovery@litera.press',
      action: 'PASSWORD_RESET_COMPLETED',
      resourceType: 'USER',
      resourceId: String(resetRow.userId),
      ip: req.ip,
    });

    res.json({ ok: true, message: 'Password updated and prior sessions revoked.' });
  } catch (error) {
    console.error('Password reset confirm error:', error);
    res.status(500).json({ error: 'Failed to update password.' });
  }
});

authRouter.patch('/profile', requireAuth, async (req: LiteraRequest, res) => {
  try {
    const parsed = profileUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid profile settings.', details: parsed.error.flatten() });
      return;
    }

    const [updated] = await db
      .insert(userProfiles)
      .values({
        userId: req.actor!.id,
        displayName: parsed.data.displayName || req.actor!.displayName,
        bio: parsed.data.bio ?? '',
        preferredTheme: parsed.data.preferredTheme ?? 'ivory',
        preferredFont: parsed.data.preferredFont ?? 'serif',
        preferredFontSize: parsed.data.preferredFontSize ?? 19,
        preferredLineHeight: parsed.data.preferredLineHeight ?? 1.75,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: userProfiles.userId,
        set: {
          ...(parsed.data.displayName !== undefined ? { displayName: parsed.data.displayName } : {}),
          ...(parsed.data.bio !== undefined ? { bio: parsed.data.bio } : {}),
          ...(parsed.data.preferredTheme !== undefined ? { preferredTheme: parsed.data.preferredTheme } : {}),
          ...(parsed.data.preferredFont !== undefined ? { preferredFont: parsed.data.preferredFont } : {}),
          ...(parsed.data.preferredFontSize !== undefined ? { preferredFontSize: parsed.data.preferredFontSize } : {}),
          ...(parsed.data.preferredLineHeight !== undefined
            ? { preferredLineHeight: parsed.data.preferredLineHeight }
            : {}),
          updatedAt: new Date(),
        },
      })
      .returning();

    res.json({ profile: updated });
  } catch (error) {
    console.error('Profile update error:', error);
    res.status(500).json({ error: 'Failed to update profile.' });
  }
});

authRouter.post('/author-profile', requireAuth, async (req: LiteraRequest, res) => {
  try {
    const parsed = authorProfileSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid author profile fields.', details: parsed.error.flatten() });
      return;
    }

    const actor = req.actor!;
    const result = await db.transaction(async (tx) => {
      if (actor.role === 'READER') {
        await tx
          .update(users)
          .set({ role: 'AUTHOR', updatedAt: new Date() })
          .where(eq(users.id, actor.id));
      }

      const [existingAuthor] = await tx
        .select()
        .from(authorProfiles)
        .where(eq(authorProfiles.userId, actor.id))
        .limit(1);

      const nextStatus =
        existingAuthor?.verificationStatus === 'VERIFIED'
          ? 'VERIFIED'
          : parsed.data.requestVerification
            ? 'PENDING'
            : existingAuthor?.verificationStatus || 'UNVERIFIED';

      const [ap] = await tx
        .insert(authorProfiles)
        .values({
          userId: actor.id,
          penName: parsed.data.penName.trim(),
          biography: parsed.data.biography.trim(),
          websiteUrl: parsed.data.websiteUrl.trim(),
          verificationStatus: nextStatus,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: authorProfiles.userId,
          set: {
            penName: parsed.data.penName.trim(),
            biography: parsed.data.biography.trim(),
            websiteUrl: parsed.data.websiteUrl.trim(),
            verificationStatus: nextStatus,
            updatedAt: new Date(),
          },
        })
        .returning();

      return ap;
    });

    await appendLiteraAudit({
      actorId: actor.id,
      actorEmail: actor.email,
      action: 'AUTHOR_PROFILE_UPDATED',
      resourceType: 'AUTHOR_PROFILE',
      resourceId: String(actor.id),
      ip: req.ip,
      metadata: { verificationStatus: result?.verificationStatus },
    });

    const updatedActor = await loadActorByUserId(actor.id, actor.sessionId);
    res.json({ authorProfile: result, user: updatedActor });
  } catch (error) {
    console.error('Author profile error:', error);
    res.status(500).json({ error: 'Failed to update author profile.' });
  }
});

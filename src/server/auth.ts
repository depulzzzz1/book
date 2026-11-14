import crypto from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { db } from '../db/index.ts';
import {
  authorProfiles,
  permissions,
  rolePermissions,
  roles,
  userProfiles,
  userSessions,
  users,
} from '../db/schema.ts';
import { adminAuth } from '../lib/firebase-admin.ts';
import { generateOpaqueToken, hashIpAddress, hashTokenSha256 } from './security.ts';

export type LiteraRole = 'READER' | 'AUTHOR' | 'EDITOR' | 'ADMIN';

export interface AuthenticatedActor {
  id: number;
  uid: string;
  email: string;
  role: LiteraRole;
  displayName: string;
  isActive: boolean;
  isVerified: boolean;
  permissions: string[];
  sessionId?: string;
}

export interface LiteraRequest extends Request {
  actor?: AuthenticatedActor;
}

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

export async function getPermissionsForRole(roleName: string): Promise<string[]> {
  try {
    const rows = await db
      .select({ code: permissions.code })
      .from(rolePermissions)
      .innerJoin(roles, eq(rolePermissions.roleId, roles.id))
      .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
      .where(eq(roles.name, roleName));
    return rows.map((r) => r.code);
  } catch {
    return [];
  }
}

export async function loadActorByUserId(
  userId: number,
  sessionId?: string
): Promise<AuthenticatedActor | null> {
  const [userRow] = await db
    .select()
    .from(users)
    .where(and(eq(users.id, userId), isNull(users.deletedAt)))
    .limit(1);

  if (!userRow || !userRow.isActive) {
    return null;
  }

  const [profile] = await db
    .select()
    .from(userProfiles)
    .where(eq(userProfiles.userId, userRow.id))
    .limit(1);

  const perms = await getPermissionsForRole(userRow.role);

  return {
    id: userRow.id,
    uid: userRow.uid,
    email: userRow.email,
    role: (userRow.role as LiteraRole) || 'READER',
    displayName: profile?.displayName || userRow.email.split('@')[0] || 'Reader',
    isActive: userRow.isActive,
    isVerified: userRow.isVerified,
    permissions: perms,
    sessionId,
  };
}

export async function createUserSession(
  userId: number,
  req: Request,
  res: Response
): Promise<{ sessionId: string; rawToken: string; csrfToken: string }> {
  const rawToken = generateOpaqueToken();
  const tokenHash = hashTokenSha256(rawToken);
  const sessionId = `sess_${crypto.randomUUID()}`;
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await db.insert(userSessions).values({
    id: sessionId,
    userId,
    tokenHash,
    userAgent: String(req.headers['user-agent'] || '').slice(0, 255),
    ipHash: hashIpAddress(req.ip),
    expiresAt,
  });

  const csrfToken = generateOpaqueToken();
  const isProd = process.env.NODE_ENV === 'production';

  res.cookie('litera_session', rawToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProd,
    maxAge: SESSION_TTL_MS,
    path: '/',
  });

  res.cookie('litera_csrf', csrfToken, {
    httpOnly: false,
    sameSite: 'lax',
    secure: isProd,
    maxAge: SESSION_TTL_MS,
    path: '/',
  });

  return { sessionId, rawToken, csrfToken };
}

export function clearSessionCookies(res: Response) {
  res.clearCookie('litera_session', { path: '/' });
  res.clearCookie('litera_csrf', { path: '/' });
}

async function resolveSessionToken(rawToken: string): Promise<AuthenticatedActor | null> {
  const tokenHash = hashTokenSha256(rawToken);
  const now = new Date();
  const [sess] = await db
    .select()
    .from(userSessions)
    .where(
      and(
        eq(userSessions.tokenHash, tokenHash),
        isNull(userSessions.revokedAt),
        gt(userSessions.expiresAt, now)
      )
    )
    .limit(1);

  if (!sess) {
    return null;
  }

  return loadActorByUserId(sess.userId, sess.id);
}

async function resolveFirebaseBearer(idToken: string): Promise<AuthenticatedActor | null> {
  try {
    const decoded = await adminAuth.verifyIdToken(idToken);
    const email = (decoded.email || `${decoded.uid}@litera.local`).toLowerCase();
    const bootstrapAdminEmail = (process.env.LITERA_BOOTSTRAP_ADMIN_EMAIL || '').toLowerCase();

    const [existing] = await db
      .select()
      .from(users)
      .where(eq(users.uid, decoded.uid))
      .limit(1);

    if (existing) {
      return loadActorByUserId(existing.id);
    }

    const assignedRole: LiteraRole =
      bootstrapAdminEmail && email === bootstrapAdminEmail ? 'ADMIN' : 'READER';

    const [created] = await db
      .insert(users)
      .values({
        uid: decoded.uid,
        email,
        role: assignedRole,
        tenantId: 'litera-public',
        authProvider: 'FIREBASE',
        isActive: true,
        isVerified: Boolean(decoded.email_verified),
      })
      .onConflictDoUpdate({
        target: users.uid,
        set: { email, updatedAt: new Date() },
      })
      .returning();

    if (!created) return null;

    const displayName = decoded.name || email.split('@')[0] || 'Literary Reader';
    await db
      .insert(userProfiles)
      .values({
        userId: created.id,
        displayName,
        bio: '',
        avatarUrl: decoded.picture || '',
      })
      .onConflictDoNothing();

    if (assignedRole === 'ADMIN') {
      await db
        .insert(authorProfiles)
        .values({
          userId: created.id,
          penName: displayName,
          biography: 'Litera Editorial Directorate',
          verificationStatus: 'VERIFIED',
          verifiedAt: new Date(),
        })
        .onConflictDoNothing();
    }

    return loadActorByUserId(created.id);
  } catch {
    return null;
  }
}

export async function resolveOptionalActor(req: LiteraRequest): Promise<AuthenticatedActor | null> {
  if (req.actor) return req.actor;

  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    if (token) {
      const localActor = await resolveSessionToken(token);
      if (localActor) {
        req.actor = localActor;
        return localActor;
      }
      const fbActor = await resolveFirebaseBearer(token);
      if (fbActor) {
        req.actor = fbActor;
        return fbActor;
      }
    }
  }

  const cookieToken = req.cookies?.litera_session as string | undefined;
  if (cookieToken) {
    const cookieActor = await resolveSessionToken(cookieToken);
    if (cookieActor) {
      req.actor = cookieActor;
      return cookieActor;
    }
  }

  return null;
}

export const optionalAuth = async (req: LiteraRequest, _res: Response, next: NextFunction) => {
  await resolveOptionalActor(req);
  next();
};

export const requireAuth = async (req: LiteraRequest, res: Response, next: NextFunction) => {
  const actor = await resolveOptionalActor(req);
  if (!actor) {
    res.status(401).json({ error: 'Authentication required. Please sign in to continue.' });
    return;
  }
  next();
};

export function requireRole(...allowedRoles: LiteraRole[]) {
  return async (req: LiteraRequest, res: Response, next: NextFunction) => {
    const actor = await resolveOptionalActor(req);
    if (!actor) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    if (!allowedRoles.includes(actor.role)) {
      res.status(403).json({
        error: `Forbidden: requires role ${allowedRoles.join(' or ')}.`,
      });
      return;
    }
    next();
  };
}

export function requirePermission(permissionCode: string) {
  return async (req: LiteraRequest, res: Response, next: NextFunction) => {
    const actor = await resolveOptionalActor(req);
    if (!actor) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    if (actor.role !== 'ADMIN' && !actor.permissions.includes(permissionCode)) {
      res.status(403).json({ error: `Forbidden: missing permission '${permissionCode}'.` });
      return;
    }
    next();
  };
}

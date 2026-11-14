import crypto from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import { argon2id, argon2Verify } from 'hash-wasm';
import sanitizeHtml from 'sanitize-html';
import { desc } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { auditLogs } from '../db/schema.ts';

// ============================================================================
// ARGON2ID PASSWORD HASHING
// ============================================================================

export async function hashPasswordArgon2id(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  return argon2id({
    password,
    salt,
    parallelism: 1,
    iterations: 2,
    memorySize: 19456, // 19 MiB OWASP baseline
    hashLength: 32,
    outputType: 'encoded',
  });
}

export async function verifyPasswordArgon2id(password: string, encodedHash: string): Promise<boolean> {
  try {
    return await argon2Verify({ password, hash: encodedHash });
  } catch {
    return false;
  }
}

// ============================================================================
// CRYPTOGRAPHIC SESSION & RESET TOKENS
// ============================================================================

export function generateOpaqueToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

export function hashTokenSha256(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function hashIpAddress(ip: string | undefined): string {
  if (!ip) return '';
  return crypto.createHash('sha256').update(`litera-ip:${ip}`).digest('hex').slice(0, 24);
}

// ============================================================================
// RICH-TEXT SANITIZATION (XSS PROTECTION)
// ============================================================================

export function sanitizeEditorialContent(rawHtml: string): string {
  return sanitizeHtml(rawHtml, {
    allowedTags: [
      'p',
      'br',
      'em',
      'i',
      'strong',
      'b',
      'blockquote',
      'h2',
      'h3',
      'ul',
      'ol',
      'li',
      'hr',
      'sup',
      'sub',
    ],
    allowedAttributes: {},
    disallowedTagsMode: 'discard',
  }).trim();
}

export function sanitizeCommentContent(rawHtml: string): string {
  return sanitizeHtml(rawHtml, {
    allowedTags: ['p', 'br', 'em', 'strong', 'blockquote'],
    allowedAttributes: {},
    disallowedTagsMode: 'discard',
  }).trim();
}

// ============================================================================
// SLIDING-WINDOW RATE LIMITER
// ============================================================================

interface RateLimitEntry {
  timestamps: number[];
}

const rateStore = new Map<string, RateLimitEntry>();

export function createRateLimiter(options: {
  windowMs: number;
  maxRequests: number;
  keyPrefix: string;
}) {
  return (req: Request, res: Response, next: NextFunction) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const key = `${options.keyPrefix}:${ip}`;
    const now = Date.now();
    const cutoff = now - options.windowMs;
    const entry = rateStore.get(key) || { timestamps: [] };
    entry.timestamps = entry.timestamps.filter((t) => t > cutoff);

    if (entry.timestamps.length >= options.maxRequests) {
      res.status(429).json({
        error: 'Too many requests. Please pause briefly before retrying.',
      });
      return;
    }

    entry.timestamps.push(now);
    rateStore.set(key, entry);
    next();
  };
}

// ============================================================================
// CSRF PROTECTION FOR COOKIE-AUTHENTICATED MUTATIONS
// ============================================================================

export function verifyCsrfForCookieAuth(req: Request, res: Response, next: NextFunction) {
  const method = req.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    next();
    return;
  }

  // Bearer token auth is inherently immune to ambient browser CSRF
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    next();
    return;
  }

  const sessionCookie = req.cookies?.litera_session as string | undefined;
  if (!sessionCookie) {
    next();
    return;
  }

  const csrfCookie = req.cookies?.litera_csrf as string | undefined;
  const csrfHeader = req.headers['x-litera-csrf'];
  if (!csrfCookie || typeof csrfHeader !== 'string' || csrfHeader !== csrfCookie) {
    res.status(403).json({ error: 'CSRF validation failed.' });
    return;
  }

  next();
}

// ============================================================================
// IMMUTABLE CRYPTOGRAPHIC AUDIT LOG
// ============================================================================

export async function appendLiteraAudit(params: {
  actorId?: number | null;
  actorEmail: string;
  action: string;
  resourceType: string;
  resourceId: string;
  ip?: string;
  metadata?: Record<string, unknown>;
}) {
  try {
    const [latest] = await db
      .select({ recordHash: auditLogs.recordHash })
      .from(auditLogs)
      .orderBy(desc(auditLogs.id))
      .limit(1);

    const previousHash = latest?.recordHash ?? 'sha256:genesis-litera-000000';
    const metadataJson = JSON.stringify(params.metadata ?? {});
    const recordHash =
      'sha256:' +
      crypto
        .createHash('sha256')
        .update(
          `${previousHash}|${params.actorEmail}|${params.action}|${params.resourceType}|${params.resourceId}|${metadataJson}`
        )
        .digest('hex')
        .slice(0, 32);

    await db.insert(auditLogs).values({
      actorId: params.actorId ?? null,
      actorEmail: params.actorEmail,
      action: params.action,
      resourceType: params.resourceType,
      resourceId: params.resourceId,
      ipHash: hashIpAddress(params.ip),
      previousHash,
      recordHash,
      metadataJson,
    });
  } catch (err) {
    console.error('Audit log append failed:', err);
  }
}

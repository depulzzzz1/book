import http from 'http';
import crypto from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLiteraApp } from '../server.ts';
import {
  hashPasswordArgon2id,
  sanitizeCommentContent,
  sanitizeEditorialContent,
  verifyPasswordArgon2id,
} from '../src/server/security.ts';

let baseUrl = '';
let server: http.Server;

async function jsonRequest(
  path: string,
  options: { method?: string; body?: unknown; token?: string } = {}
) {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (options.token) {
    headers['Authorization'] = `Bearer ${options.token}`;
  }
  const res = await fetch(`${baseUrl}${path}`, {
    method: options.method || 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  const data = (await res.json()) as Record<string, any>;
  return { status: res.status, data };
}

beforeAll(async () => {
  const app = createLiteraApp();
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') {
        baseUrl = `http://127.0.0.1:${addr.port}`;
      }
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('Security Primitives (Argon2id & HTML Sanitization)', () => {
  it('hashes and verifies passwords with Argon2id using unique salts', async () => {
    const pw = 'LiteraManuscript2026!';
    const h1 = await hashPasswordArgon2id(pw);
    const h2 = await hashPasswordArgon2id(pw);
    expect(h1).toContain('$argon2id$');
    expect(h1).not.toEqual(h2);
    expect(await verifyPasswordArgon2id(pw, h1)).toBe(true);
    expect(await verifyPasswordArgon2id('WrongPassword!', h1)).toBe(false);
  });

  it('strips malicious XSS payloads from editorial prose and comments', () => {
    const cleanProse = sanitizeEditorialContent(
      '<p onclick="evil()">Chapter text</p><script>steal()</script><a href="javascript:alert(1)">click</a>'
    );
    expect(cleanProse).toContain('<p>Chapter text</p>');
    expect(cleanProse).not.toContain('script');
    expect(cleanProse).not.toContain('onclick');
    expect(cleanProse).not.toContain('javascript:');

    const cleanComment = sanitizeCommentContent('<img src=x onerror=alert(1)><p>Insightful</p>');
    expect(cleanComment).toBe('<p>Insightful</p>');
  });
});

describe('API Integration, RBAC Authorization, Optimistic Concurrency & Session Revocation', () => {
  it('returns seeded published novels and blocks unauthenticated studio/admin access', async () => {
    const catalog = await jsonRequest('/api/novels');
    expect(catalog.status).toBe(200);
    expect(Array.isArray(catalog.data.novels)).toBe(true);
    expect(catalog.data.novels.length).toBeGreaterThanOrEqual(4);
    expect(catalog.data.novels.every((n: any) => n.status === 'PUBLISHED')).toBe(true);

    const studioUnauth = await jsonRequest('/api/studio/novels');
    expect(studioUnauth.status).toBe(401);

    const adminUnauth = await jsonRequest('/api/admin/overview');
    expect(adminUnauth.status).toBe(401);
  });

  it('enforces Reader RBAC boundaries and rejects privilege escalation', async () => {
    const email = `reader-${crypto.randomUUID().slice(0, 8)}@litera-test.org`;
    const reg = await jsonRequest('/api/auth/register', {
      method: 'POST',
      body: {
        email,
        password: 'ReaderPassword99!',
        displayName: 'Test Reader',
        accountType: 'reader',
      },
    });
    expect(reg.status).toBe(201);
    const token = reg.data.sessionToken as string;

    const studioForbidden = await jsonRequest('/api/studio/novels', { token });
    expect(studioForbidden.status).toBe(403);

    const adminForbidden = await jsonRequest('/api/admin/overview', { token });
    expect(adminForbidden.status).toBe(403);
  });

  it('supports Author manuscript creation, hides unpublished drafts from public catalog, enforces optimistic concurrency, and revokes sessions', async () => {
    const email = `author-${crypto.randomUUID().slice(0, 8)}@litera-test.org`;
    const reg = await jsonRequest('/api/auth/register', {
      method: 'POST',
      body: {
        email,
        password: 'AuthorPassword99!',
        displayName: 'Test Author',
        accountType: 'author',
        penName: 'A. S. Testwriter',
      },
    });
    expect(reg.status).toBe(201);
    const token = reg.data.sessionToken as string;
    const sessionId = reg.data.user.sessionId as string;

    // Create draft novel
    const novelRes = await jsonRequest('/api/studio/novels', {
      method: 'POST',
      token,
      body: {
        title: `Unpublished Draft ${crypto.randomUUID().slice(0, 6)}`,
        subtitle: 'Private study',
        synopsis: 'A private manuscript draft that must never appear in the public catalog before publication.',
        genreIds: [1],
      },
    });
    expect(novelRes.status).toBe(201);
    const novel = novelRes.data.novel;

    // Verify unpublished novel is invisible on public endpoints
    const publicDetail = await jsonRequest(`/api/novels/${novel.slug}`);
    expect(publicDetail.status).toBe(404);

    // Create chapter & test optimistic concurrency 409 conflict
    const chapRes = await jsonRequest(`/api/studio/novels/${novel.id}/chapters`, {
      method: 'POST',
      token,
      body: { title: 'Chapter One Draft', contentHtml: '<p>Initial prose.</p>' },
    });
    expect(chapRes.status).toBe(201);
    const chap = chapRes.data.chapter;

    const firstEdit = await jsonRequest(`/api/studio/chapters/${chap.id}`, {
      method: 'PATCH',
      token,
      body: {
        title: 'Chapter One Revised',
        contentHtml: '<p>Updated prose.</p>',
        createRevision: true,
        expectedVersion: chap.version,
      },
    });
    expect(firstEdit.status).toBe(200);

    // Stale expectedVersion must trigger 409 Conflict
    const staleEdit = await jsonRequest(`/api/studio/chapters/${chap.id}`, {
      method: 'PATCH',
      token,
      body: {
        title: 'Stale Overwrite Attempt',
        contentHtml: '<p>Should fail.</p>',
        expectedVersion: chap.version,
      },
    });
    expect(staleEdit.status).toBe(409);

    // Session revocation must immediately invalidate token
    const revokeRes = await jsonRequest(`/api/auth/sessions/${sessionId}`, {
      method: 'DELETE',
      token,
    });
    expect(revokeRes.status).toBe(200);

    const afterRevoke = await jsonRequest('/api/studio/novels', { token });
    expect(afterRevoke.status).toBe(401);
  });
});

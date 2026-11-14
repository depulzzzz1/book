# PROJECT LITERA — Security Architecture & Threat Controls

## 1. Password Hashing & Credential Protection
- **Argon2id** (`hash-wasm` in Node runtime / `argon2-cffi` in FastAPI Docker runtime) with per-user 16-byte cryptographic random salt, 19 MiB memory cost (`m=19456`), `t=2`, `p=1`.
- Passwords are never stored or logged in plaintext; password recovery tokens are 32-byte `base64url` random secrets stored exclusively as SHA-256 digests with 30-minute expiration and automatic session revocation upon reset.

## 2. Revocable Sessions & CSRF Protection
- Session tokens are opaque 256-bit random values stored SHA-256 hashed in `user_sessions` and issued via `HttpOnly`, `SameSite=Lax` cookies (or explicit `Bearer` header).
- Cookie-authenticated mutations require double-submit `X-Litera-CSRF` header validation matching `litera_csrf`.
- Users can inspect and revoke individual sessions or all other active sessions at any time.

## 3. Server-Side RBAC & Resource Ownership
- All protected routes validate identity, account suspension status (`is_active`), role (`READER`, `AUTHOR`, `EDITOR`, `ADMIN`), and resource ownership (`novel.author_id === actor.id`) server-side.
- Unpublished manuscripts (`DRAFT`, `PENDING_REVIEW`, `REJECTED`) and unpublished chapters are strictly excluded from public catalog endpoints.

## 4. XSS, SQLi & Rate-Limiting Controls
- Rich-text manuscripts and reader comments pass through both `sanitize-html` and `litera_core/domain_engine.py` allowlist HTML parsers before database persistence.
- All database access uses parameterized Drizzle ORM / SQLAlchemy 2 bindings.
- Auth, review, comment, and reporting routes enforce sliding-window rate limits.
- Security-relevant events append to `audit_logs` using a SHA-256 hash chain (`previous_hash` -> `record_hash`).

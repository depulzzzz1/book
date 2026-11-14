# PROJECT LITERA — REST API Reference

All routes are served under `/api/*` with JSON payloads, Zod schema validation, Argon2id/Bearer/Session authentication, CSRF double-submit verification for cookie sessions, and PostgreSQL persistence.

---

## 1. Health & Diagnostics

| Method | Path | Auth | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/health` | Public | Lightweight service liveness check (`{ status: 'ok', service: 'litera-api' }`). |

---

## 2. Identity & Session Management (`/api/auth`)

| Method | Path | Auth | Description |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/auth/register` | Public | Register a `reader` or `author` account with Argon2id password hashing and issue a session token + HttpOnly cookie. |
| `POST` | `/api/auth/login` | Public | Authenticate email + password via Argon2id verification with per-IP rate limiting. |
| `POST` | `/api/auth/firebase` | Firebase ID Token | Federate Firebase Google Sign-In token into a Litera user session. |
| `GET` | `/api/auth/me` | Authenticated | Return current user, profile, author dossier, and active session ID. |
| `POST` | `/api/auth/logout` | Authenticated | Revoke current session and clear cookies. |
| `GET` | `/api/auth/sessions` | Authenticated | List active sessions for the current user. |
| `DELETE` | `/api/auth/sessions/:sessionId` | Authenticated | Revoke a specific active session (`revoked_at = NOW()`). |
| `POST` | `/api/auth/password-reset/request` | Public | Generate a single-use expiring SHA-256 reset token. |
| `POST` | `/api/auth/password-reset/confirm` | Public | Verify reset token, update Argon2id password hash, and revoke all existing sessions. |
| `PATCH` | `/api/auth/profile` | Authenticated | Update user display name, bio, locale, and author pen name/website. |

---

## 3. Digital Novel Library (`/api`)

| Method | Path | Auth | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/genres` | Public | List editorial genres with slug and display metadata. |
| `GET` | `/api/novels` | Public | Query published catalog (`q`, `genre`, `sort=popular\|recent\|rating\|wordcount`). Never returns `DRAFT`/`PENDING_REVIEW`/`REJECTED` works. |
| `GET` | `/api/novels/:slug` | Public | Fetch full novel details, genre tags, published chapters, reviews, and personalized Python-ranked recommendations. |
| `GET` | `/api/authors/:idOrSlug` | Public | Fetch public author dossier, verification status, published bibliography, and follower count. |

---

## 4. Reading Engine & Personal Shelf (`/api/reader`)

| Method | Path | Auth | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/reader/novels/:slug/chapters/:chapterNumber` | Optional Auth | Read a published chapter (author/editor/admin can preview unpublished chapters), plus typography preferences and bookmark state. |
| `PUT` | `/api/reader/progress` | Authenticated | Synchronize reading position with optimistic concurrency check (`expectedVersion`). |
| `GET` | `/api/reader/history` | Authenticated | List recent reading progress across novels. |
| `GET` | `/api/reader/bookmarks` | Authenticated | List user bookmarks across chapters. |
| `POST` | `/api/reader/bookmarks` | Authenticated | Create a chapter bookmark with excerpt and optional reader note. |
| `DELETE` | `/api/reader/bookmarks/:id` | Authenticated | Delete a bookmark owned by the current user. |
| `GET` | `/api/reader/lists` | Authenticated | Fetch user reading lists and saved novels. |
| `POST` | `/api/reader/lists` | Authenticated | Create a personal reading list (`PRIVATE` or `PUBLIC`). |
| `POST` | `/api/reader/lists/:listId/items` | Authenticated | Add a novel to a personal reading list. |
| `DELETE` | `/api/reader/lists/:listId/items/:novelId` | Authenticated | Remove a novel from a personal reading list. |
| `PATCH` | `/api/reader/preferences` | Authenticated | Persist reader typography (`theme`, `fontFamily`, `fontSizePx`, `lineHeight`). |

---

## 5. Author Studio (`/api/studio`)

Requires `AUTHOR`, `EDITOR`, or `ADMIN` role.

| Method | Path | Auth | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/studio/novels` | Author+ | List author's own novels, chapter counts, and aggregated studio analytics. |
| `POST` | `/api/studio/novels` | Author+ | Create a new novel manuscript (`DRAFT`) and link genre tags. |
| `PATCH` | `/api/studio/novels/:id` | Owner/Admin | Update novel metadata (`expectedVersion` optimistic concurrency) or submit (`PENDING_REVIEW`). |
| `GET` | `/api/studio/novels/:id/chapters` | Owner/Admin | List all chapters (including drafts/scheduled) for a manuscript. |
| `POST` | `/api/studio/novels/:id/chapters` | Owner/Admin | Create a chapter; HTML sanitized via Python `EditorialHtmlSanitizer` + `sanitize-html`, readability analyzed, and initial `chapter_versions` snapshot stored. |
| `PATCH` | `/api/studio/chapters/:chapterId` | Owner/Admin | Debounced autosave or manual revision snapshot (`409 Conflict` on stale `expectedVersion`). |
| `GET` | `/api/studio/chapters/:chapterId/versions` | Owner/Admin | List immutable chapter revision snapshots. |
| `GET` | `/api/studio/chapters/:chapterId/diff` | Owner/Admin | Compute unified line diff between two chapter revisions via Python `compute_revision_diff`. |
| `POST` | `/api/studio/chapters/:chapterId/restore` | Owner/Admin | Restore a chapter to a historical revision snapshot. |
| `POST` | `/api/studio/chapters/:chapterId/publish` | Owner/Admin | Publish immediately or schedule future publication via `publication_events`. |

---

## 6. Community & Moderation Intake (`/api/community`)

| Method | Path | Auth | Description |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/community/novels/:novelId/reviews` | Authenticated | Submit or update a 1–5 star review and recalculate novel rating average. |
| `GET` | `/api/community/chapters/:chapterId/comments` | Public | Fetch active threaded chapter comments. |
| `POST` | `/api/community/chapters/:chapterId/comments` | Authenticated | Post a sanitized comment or reply. |
| `POST` | `/api/community/authors/:authorId/follow` | Authenticated | Toggle following an author and notify on new follow. |
| `GET` | `/api/community/follows` | Authenticated | List followed author IDs. |
| `GET` | `/api/community/notifications` | Authenticated | Fetch user notifications and unread count. |
| `POST` | `/api/community/notifications/read-all` | Authenticated | Mark all notifications as read. |
| `POST` | `/api/community/reports` | Authenticated | Submit a content moderation report (`NOVEL`, `CHAPTER`, `REVIEW`, `COMMENT`). |

---

## 7. Administration & Governance (`/api/admin`)

Requires `EDITOR` or `ADMIN` role (`users`, `permissions`, `configs` strictly require `ADMIN`).

| Method | Path | Auth | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/admin/overview` | Editor/Admin | Fetch platform analytics, pending novels, pending author verifications, open reports, hash-chained audit logs, and system configs. |
| `POST` | `/api/admin/novels/:id/decision` | Editor/Admin | `APPROVE` (`PUBLISHED`) or `REJECT` a pending novel manuscript. |
| `POST` | `/api/admin/authors/:userId/verify` | Editor/Admin | Verify or decline an author verification request. |
| `POST` | `/api/admin/reports/:id/resolve` | Editor/Admin | `HIDE_CONTENT` or `DISMISS` a moderation report. |
| `GET` | `/api/admin/users` | Admin | List registered accounts and roles. |
| `PATCH` | `/api/admin/users/:id/role` | Admin | Update user role or suspend/reactivate account (automatically revoking active sessions on suspension). |
| `GET` | `/api/admin/permissions` | Admin | Inspect RBAC roles, permissions, and `role_permissions` mappings. |
| `PUT` | `/api/admin/configs/:key` | Admin | Update platform system configuration flags. |

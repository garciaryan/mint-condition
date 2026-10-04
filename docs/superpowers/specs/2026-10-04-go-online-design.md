# Go Online: hosting, login, database foundation

Date: 2026-10-04 · Status: approved design, awaiting spec review

## Why

Collection mode (Phase 4) will be used on-site with only a phone, on-site with a laptop, and at a desk, and a
session started on one device must be finishable on another. That needs the app reachable from anywhere and
sessions stored server-side. This sub-project puts the existing app online behind a login and lays the SQLite
foundation. Collection mode gets its own spec afterwards and builds on this.

Success: from a phone on mobile data, log in at the public URL, price a record, and see the result card. With no
valid cookie, nothing (pages or API) is reachable except the login page and health check.

## Decisions this replaces

CLAUDE.md "Runs on localhost only; no deploy, no auth" becomes: hosted on Fly.io, single-password login, Discogs
token stored as a Fly secret. Unchanged: personal access token (no OAuth), token never sent to the browser, pure
`lib/pricing.ts` / `lib/offer.ts`, tunables in `settings.json`.

## 1. Deployment

- `next.config.ts` with `output: "standalone"`.
- Multi-stage `Dockerfile` (deps → build → slim runtime) on `node:24-slim`. `.dockerignore` excludes `.env*`,
  `node_modules`, `.next`, `data/`.
- `fly.toml`: one machine (shared-cpu-1x, 512 MB), `auto_stop_machines`/`auto_start_machines` on, `min_machines_running = 0`,
  `force_https = true`, a 1 GB volume mounted at `/data`, HTTP health check on `/api/health`. Exactly one machine:
  SQLite and the shared Discogs throttle both assume a single process. Do not scale out.
- Secrets via `fly secrets set`: `DISCOGS_TOKEN`, `DISCOGS_USER_AGENT`, `APP_PASSWORD_HASH`, `SESSION_SECRET`.
  Plain env in `fly.toml`: `DATA_DIR=/data`, `NODE_ENV=production`.
- `settings.json` ships in the image, read-only, until the Phase 6 settings UI.
- Deploys run `fly deploy` from the local machine. No CI.
- New script `npm run hash-password`: prompts for a password without echo, prints the hash for `APP_PASSWORD_HASH`.
- Local dev is unchanged: `npm run dev` with `.env.local`.

## 2. Login

**Password.** scrypt via `node:crypto` with a random 16-byte salt. Stored format:
`scrypt$<N>$<r>$<p>$<salt b64>$<hash b64>`. Comparison uses `timingSafeEqual`.

**Session cookie.** `mc_session` = `<expiresAtMs>.<HMAC-SHA256(expiresAtMs, SESSION_SECRET) b64url>`. Flags:
`HttpOnly`, `Secure` (production), `SameSite=Lax`, `Path=/`, `Max-Age` 30 days. There is no server-side session
table. Rotating `SESSION_SECRET` logs out every device. Verification uses Web Crypto (`crypto.subtle`), so it runs
in middleware on either runtime.

**Routes.**
- `GET /login`: page with one password field. It has a visible label, a show/hide toggle,
  `autocomplete="current-password"`, an inline error under the field (`aria-describedby`), 16px text and 44px
  controls. It reads `?next=` and only follows same-origin relative paths.
- `POST /api/login`: verifies the password, sets the cookie, returns `{ ok: true }`. On failure it waits about 500 ms
  and returns 401. When the IP is limited it returns 429 with the minutes remaining.
- `POST /api/logout`: clears the cookie. A "Log out" link sits in the page header.

**Middleware (`middleware.ts`).** Public paths: `/login`, `/api/login`, `/api/health`, `/_next/*`, `/favicon.ico`.
Everything else needs a valid cookie.
- Pages without a valid cookie redirect to `/login?next=<path>`.
- `/api/*` without a valid cookie returns 401 `{ status: "error", kind: "auth", message }`.
- Non-GET/HEAD requests must carry an `Origin` header matching the request host, or they get a 403.

**Rate limit.** 5 failed logins per IP per 15 minutes, then 429. The counter is in memory, which is fine with a
single process, and resets on restart. The client IP comes from `Fly-Client-IP`, falling back to the first
`X-Forwarded-For` entry, then `"local"`.

**Failing safely.**
- Production (`NODE_ENV=production`) with `APP_PASSWORD_HASH` or `SESSION_SECRET` unset: every non-public route
  returns 503 "Login not configured: missing X", naming the variables but never values.
- Development with both unset: login is disabled and a console warning is printed once.
- Development with only one of the two set: treated as misconfigured, so the 503 above.

**Client.** `LookupErrorKind` gains `"auth"`. `Lookup.tsx` treats an `auth` response as
`location.assign("/login?next=/")` instead of rendering an error card.

## 3. Database foundation

- `lib/db.ts`: `getDb()` opens `${DATA_DIR ?? "./data"}/mint.db` with `node:sqlite` `DatabaseSync`, creating the
  directory if missing. It sets `PRAGMA journal_mode=WAL` and `PRAGMA foreign_keys=ON`, then runs migrations. The
  connection is a singleton on `globalThis`.
- `lib/migrations.ts`: `export const migrations: string[]` (SQL, index + 1 = version) and
  `migrate(db, migrations)`, which applies each step above `PRAGMA user_version` inside `BEGIN`/`COMMIT`, setting
  `user_version` in the same transaction. A failure rolls back that step and throws. The list ships empty.
- `GET /api/health` (public): runs `select 1`. It returns 200 `{ ok: true, db: "ok", config: { <var>: true|false } }`
  or 503 with the failing part. It reports variable presence only, never values.
- `./data/` is added to `.gitignore` and `.dockerignore`.
- Backups rely on Fly volume daily snapshots (default 5-day retention). `DEPLOY.md` documents restoring and
  `fly ssh sftp get /data/mint.db`.
- Node requirement becomes 22.13+ (unflagged `node:sqlite`). Verify `next build` leaves `node:sqlite` external.
  If not, add it to `serverExternalPackages`.

## 4. Testing and rollout

**Unit tests.**
- `tests/auth.test.ts`:
  - hash/verify: right password, wrong password, malformed stored hash
  - cookie sign/verify: valid, expired, tampered value, wrong secret (clock injected)
  - limiter: blocks after 5 failures, resets after the window, tracks IPs independently
  - `isPublicPath`
  - `authMode(env)`: `"off" | "on" | "misconfigured"`
  - `safeNext`: rejects absolute and protocol-relative URLs
- `tests/db.test.ts`, against `:memory:`:
  - applies steps in order
  - is idempotent on re-run
  - a failing step rolls back and leaves `user_version` unchanged

`npm test`, `npm run typecheck` and `next build` must all pass.

**Manual verification.**
1. `docker build` and `docker run` locally with test secrets. Check login, logout, the redirect with `next`, a 401
   from `/api/lookup` without a cookie, the 403 on a cross-origin POST, the 503 with secrets unset, and the health
   check.
2. `fly launch --no-deploy`, `fly volumes create`, `fly secrets set`, then `fly deploy`. The user runs the
   account-bound commands.
3. On a phone over mobile data: log in, look up a record, see the result card.

**Docs.** Update CLAUDE.md (decisions, commands, layout, Node 22.13+, status). Add `DEPLOY.md` covering first-time
setup, secrets, deploy, `fly logs`, backup and restore.

## Out of scope

Collection sessions and their tables (Phase 4 spec), the 24h price cache and settings UI (Phase 6), a custom
domain, CI, multi-user accounts.

# Connect Discogs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A shop presses Connect Discogs, approves on discogs.com and prices records, with no personal access token; apps with `DISCOGS_TOKEN` keep working unchanged.

**Architecture:** Pure OAuth 1.0a signing (`lib/discogs-oauth.ts`), a one-row `discogs_auth` table (migration 7, `lib/discogs-auth-store.ts`), a pure access resolver (`lib/discogs-access.ts`) that the shared `DiscogsClient` calls per request, three routes under `app/api/discogs/`, and a Settings card plus Connect prompts.

**Tech Stack:** Next.js App Router route handlers and server components, `node:crypto` (HMAC-SHA1), `node:sqlite`, Node's test runner.

**Spec:** `docs/superpowers/specs/2026-10-08-connect-discogs-design.md`

## Global Constraints

- Branch `feat/connect-discogs`. No new npm dependency.
- Env names: `DISCOGS_TOKEN` (wins), `DISCOGS_CONSUMER_KEY`, `DISCOGS_CONSUMER_SECRET`, `DISCOGS_USER_AGENT` (always required).
- Discogs URLs: `https://api.discogs.com/oauth/request_token` (POST), `https://www.discogs.com/oauth/authorize?oauth_token=`, `https://api.discogs.com/oauth/access_token` (POST), `https://api.discogs.com/oauth/identity` (GET).
- Pending sign-in lives at most `PENDING_MAX_MS = 600_000`.
- New error kind `not-connected` → HTTP 409, message "Connect your Discogs account to start pricing."
- OAuth 401 message: "Discogs no longer accepts this app's access. Reconnect Discogs in Settings."
- `?discogs=` values: `connected`, `denied`, `error`, `disconnected`; copy exactly as the spec's UI section.
- Never log or return token/secret values; health never includes the username.
- `lib/` pure where the spec says so, relative `.ts` imports; `app/api/` relative imports; UI `@/`. Colours only from tokens.
- Migration 7 is appended to `lib/migrations.ts`; never edit shipped steps.
- Keep `npm test` and `npm run typecheck` green after each task; check for a running `next dev` before any `npm run build`.

## Review Focus

1. **Session expired while on discogs.com:** the callback hits the gate, which redirects to login; after login the user must land back on the callback with `oauth_token`/`oauth_verifier` intact (within 10 min it completes). Pinned by a gate test (Task 6).
2. **Double-clicked Connect:** the second request token overwrites the first pending; the first callback then mismatches → `?discogs=error`, nothing saved, and "Try again" works. Pinned by a store test (Task 3).
3. **Token set and a stale connection row present:** token wins everywhere (client, card, health). Pinned by `discogsAccess` and card tests (Tasks 4, 7).
4. **Discogs' request-token reply carries extra fields** (`oauth_callback_confirmed=true`): parsing ignores them. Pinned by a `parseTokenBody` test (Task 1).
5. **Connecting a different account than before:** cached suggestions from the old account are never served. Pinned by the store's cache-clearing test (Task 3).

---

### Task 1: OAuth signing

**Files:** Create `lib/discogs-oauth.ts`, `tests/discogs-oauth.test.ts`

**Interfaces — Produces:** `OAuthParams`, `oauthHeader(p: OAuthParams): string`, `parseTokenBody(text: string): { token: string; secret: string }`, `callbackUrl(host: string, proto: string | null): string`, `percentEncode(s: string): string` (exported for tests), `newNonce(): string` (random 32 hex chars).

- [ ] **Step 1: Failing tests:**
  - RFC 5849 §3.4.1 example: `method "POST"`, `url "http://example.com/request?b5=%3D%253D&a3=a&c%40=&a2=r%20b"`, consumer key `9djdj82h48djs9d2`, consumer secret `j49sk3j29djd`, token `kkk9d7dh3k39sjv7`, token secret `dh893hdasih9`, nonce `7d8f3e4a`, timestamp `137131201` — the header's `oauth_signature` decodes to the HMAC-SHA1 of the RFC's base string with key `j49sk3j29djd&dh893hdasih9`. (The RFC example also signs `c2` and `a3=2 q` from a form body; this API never sends body params, so compute the expected value in the test with `createHmac` over the base string built from the RFC's listed oauth params plus the URL's query only, and assert equality. Also assert the base string itself via an exported `signatureBaseString(p)`.)
  - `percentEncode("Ladies + Gentlemen")` → `"Ladies%20%2B%20Gentlemen"`; `percentEncode("!*'()")` → `"%21%2A%27%28%29"`; `percentEncode("-._~")` unchanged.
  - Header contains `oauth_signature_method="HMAC-SHA1"`, `oauth_version="1.0"`, `oauth_callback` only when given, `oauth_verifier` only when given, no `oauth_token` when absent.
  - `parseTokenBody("oauth_token=t&oauth_token_secret=s&oauth_callback_confirmed=true")` → `{ token: "t", secret: "s" }`; missing secret throws; `"<html>"` throws.
  - `callbackUrl("mc-groove.fly.dev", "https")` → `https://mc-groove.fly.dev/api/discogs/callback`; `("records.example", null)` → `https://…`; `("localhost:3000", "http")` → `http://localhost:3000/api/discogs/callback`.
- [ ] **Step 2: Run** `node --experimental-strip-types --no-warnings --test tests/discogs-oauth.test.ts` — FAIL (missing module).
- [ ] **Step 3: Implement** per the spec's Signing section (`signatureBaseString` exported).
- [ ] **Step 4: Run** — PASS; `npm test`, `npm run typecheck` green.
- [ ] **Step 5: Commit** `feat(oauth): OAuth 1.0a HMAC-SHA1 signing for Discogs`

### Task 2: Live check (owner registers the Discogs application)

Needs the owner: discogs.com → Settings → Developers → create application "Mint Condition"; put `DISCOGS_CONSUMER_KEY` and `DISCOGS_CONSUMER_SECRET` in `.env.local` (never committed). Ask for this, then:

- [ ] **Step 1:** A scratchpad script (not committed) using Task 1 POSTs `request_token` with `oauth_callback=https://mint-condition.fly.dev/api/discogs/callback`, then with `http://localhost:3000/api/discogs/callback`. Expected: both return a token body. Record the result.
- [ ] **Step 2:** If either is refused, stop and tell the owner; the spec's fallback (one Discogs application per shop) changes only the runbook and the "One Discogs application" decision — record a Ruling.
- [ ] **Step 3:** Write the outcome into the spec's Status line; commit `docs: Connect Discogs live check`.

### Task 3: Storage

**Files:** Modify `lib/migrations.ts`; create `lib/discogs-auth-store.ts`, `tests/discogs-auth-store.test.ts`

**Interfaces — Produces:** `Connection`, `PENDING_MAX_MS`, `getConnection(db)`, `saveConnection(db, c)`, `clearConnection(db)`, `savePending(db, token, secret, at)`, `takePending(db, token, now): { secret: string } | null` (signatures in the spec).

- [ ] **Step 1: Failing tests** (`openDb(":memory:")`): migration 7 creates `discogs_auth` (and `pragma user_version` is 7); `getConnection` null on a fresh db; save → get round-trips; clear → null; `saveConnection` clears pending; `takePending` returns the secret once, then null; wrong token → null and pending cleared; at `PENDING_MAX_MS + 1` ms old → null; a second `savePending` replaces the first (first token now → null); `saveConnection` and `clearConnection` each delete all `discogs_cache` rows (insert two first); an existing db at version 6 with data migrates to 7 keeping its rows.
- [ ] **Step 2: Run** `node --experimental-strip-types --no-warnings --test tests/discogs-auth-store.test.ts` — FAIL.
- [ ] **Step 3: Implement** the migration (spec SQL) and store (upsert row id 1).
- [ ] **Step 4: Run** — PASS; `npm test` (db tests may assert the migration count — update them) and `npm run typecheck` green.
- [ ] **Step 5: Commit** `feat(oauth): store the Discogs connection (migration 7)`

### Task 4: Access resolver and client auth

**Files:** Create `lib/discogs-access.ts`, `tests/discogs-access.test.ts`; modify `lib/discogs.ts`, `lib/discogs-client.ts`, `scripts/lookup.ts`, `tests/discogs.test.ts` (`makeClient` passes `auth`)

**Interfaces:**
- Consumes: Task 1 `oauthHeader`, `newNonce`; Task 3 `Connection`, `getConnection`.
- Produces: `DiscogsAccess`, `discogsAccess(env, connection): DiscogsAccess`, `setupMissing(env): string[]` (names: `"DISCOGS_TOKEN (or DISCOGS_CONSUMER_KEY and DISCOGS_CONSUMER_SECRET)"`, `"DISCOGS_USER_AGENT"`); `ClientOptions` now `{ auth: () => DiscogsAccess; userAgent; fetchImpl?; minIntervalMs?; sleep?; now?; nonce?: () => string }` (no `token`); `DiscogsError` gains optional `kind?: "not-connected"`.

- [ ] **Step 1: Failing tests:**
  - `discogsAccess`: token + connection → `token`; consumer pair + connection → `oauth` with `username`; consumer pair, no connection → `none/not-connected`; only one consumer var → `none/setup`; nothing → `none/setup`; no user agent with a token → `none/setup`; whitespace-only token ignored. `setupMissing({})` lists both names.
  - Client: with oauth access, two requests send `Authorization` starting `OAuth ` with different `oauth_nonce` values (injected `nonce` counter) and the access token; with token access, `Discogs token=…` as before; `none` → rejects with `DiscogsError` `kind: "not-connected"` and no fetch; a 401 under oauth → message contains "Reconnect Discogs in Settings"; a 401 under token keeps today's message.
- [ ] **Step 2: Run** the two test files — FAIL.
- [ ] **Step 3: Implement.** `getDiscogsClient()` builds `auth: () => discogsAccess(process.env, getConnection(getDb()))`; `scripts/lookup.ts` uses `auth: () => ({ kind: "token", token })`.
- [ ] **Step 4: Run** — PASS; `npm test` (route tests inject fake clients and set `DISCOGS_TOKEN`, so they stay green), `npm run typecheck` green.
- [ ] **Step 5: Commit** `feat(oauth): the Discogs client signs with a token or the stored connection`

### Task 5: Readiness in routes, worker and health

**Files:** Modify `lib/lookup.ts`, `app/api/lookup/route.ts`, `app/api/releases/[id]/identifiers/route.ts`, `app/api/masters/[id]/versions/route.ts`, `lib/collection/worker.ts`, `lib/auth.ts` (`configStatus`), `app/api/health/route.ts`, and their tests (`tests/lookup.test.ts`, `tests/lookup-route.test.ts`, `tests/identifiers-route.test.ts`, `tests/versions-route.test.ts`, `tests/collection-worker.test.ts`, `tests/auth.test.ts`, `tests/health.test.ts`)

**Interfaces:**
- Consumes: Task 4 `discogsAccess`, `setupMissing`, `DiscogsError.kind`; Task 3 `getConnection`.
- Produces: `discogsReady(access: DiscogsAccess, env): Extract<LookupResponse, {status:"error"}> | null`; `LookupErrorKind` includes `"not-connected"` (`httpStatus` 409); `missingEnv` removed; `configStatus(env, discogs: "token" | "connected" | "not-connected" | "setup")` with `vars` gaining `DISCOGS_CONSUMER_KEY`, `DISCOGS_CONSUMER_SECRET`, and `ok` false only for `setup` (plus existing password/session rules); health body gains `discogs`.

- [ ] **Step 1: Failing tests:** `discogsReady` → null for token/oauth, `not-connected` 409 with the exact message, `setup` → `missing-env` naming `setupMissing` (never values); each of the three routes with consumer vars set, no token, empty db → 409 `not-connected`; `toErrorResponse` of a `not-connected` DiscogsError → kind `not-connected`; worker: `kickWorker` does nothing when access is `none` (a pending item stays `pending`), and prices it once a connection is saved and the worker is kicked (fake client); health: consumer vars, no connection → 200 `ok:true`, `discogs:"not-connected"`; nothing set → 503 with `discogs:"setup"`; body never contains the consumer secret value or a saved username.
- [ ] **Step 2: Run** those files — FAIL.
- [ ] **Step 3: Implement.** Routes open the db before the readiness check (database errors still report `database`). Replace the existing `missingEnv` tests with `discogsReady`/`setupMissing` equivalents.
- [ ] **Step 4: Run** — PASS; `npm test`, `npm run typecheck` green.
- [ ] **Step 5: Commit** `feat(oauth): not-connected instead of missing-env; worker and health follow the connection`

### Task 6: Connect, callback, disconnect

**Files:** Create `app/api/discogs/connect/route.ts`, `app/api/discogs/callback/route.ts`, `app/api/discogs/disconnect/route.ts`, `lib/discogs-connect.ts` (the flow, injectable fetch/now/nonce), `tests/discogs-connect.test.ts`

**Interfaces:**
- Consumes: Tasks 1, 3, 4; `kickWorker` from `lib/collection/worker.ts`; `requireSession` from `lib/route-auth.ts`.
- Produces: `startConnect(deps, host, proto): Promise<{ location: string }>`, `finishConnect(deps, query: URLSearchParams): Promise<{ location: string }>` — `deps = { db, env, fetchImpl, now, nonce, userAgent }`; locations exactly `/settings?discogs=<value>` or the authorize URL.

- [ ] **Step 1: Failing tests** (fake fetch answering request_token / access_token / identity): connect with consumer vars → location `https://www.discogs.com/oauth/authorize?oauth_token=rt` and pending saved, request carried `oauth_callback` for the given host; token mode → `/settings`; no consumer vars → throws a `setup` error (route maps to 503 JSON); callback success → connection saved with identity's `username`, cache cleared, location `/settings?discogs=connected`; `denied` → `?discogs=denied`, nothing saved; mismatched token → `?discogs=error`; pending older than 10 min → `?discogs=error`; access_token HTTP 500 → `?discogs=error`, nothing saved; disconnect route → connection cleared, 303 to `/settings?discogs=disconnected`; each route 401 without a session; gate: an unauthenticated `GET /api/discogs/callback?oauth_token=a&oauth_verifier=b` redirects to `/login?next=` that decodes to `/api/discogs/callback?oauth_token=a&oauth_verifier=b`.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement.** Routes read `host` and `x-forwarded-proto` headers, call the lib, respond `303` with `Location`; the callback calls `kickWorker()` after a save. Discogs calls here use `fetch` directly with the User-Agent (one call per step; not cached).
- [ ] **Step 4: Run** — PASS; `npm test`, `npm run typecheck` green.
- [ ] **Step 5: Commit** `feat(oauth): connect, callback and disconnect routes`

### Task 7: UI

**Files:** Create `components/settings/DiscogsCard.tsx` (server), `components/settings/DiscogsNotice.tsx` (client: notice + `history.replaceState`), `components/lookup/ConnectCard.tsx`; modify `app/settings/page.tsx`, `app/page.tsx`, `components/lookup/Lookup.tsx` (render ConnectCard for `not-connected`), `app/collection/[id]/page.tsx` or `components/collection/LotView.tsx` (notice), `app/globals.css`; test `tests/connect-ui.test.ts`

**Interfaces:** Consumes `discogsAccess`, `getConnection`, `getDb`. Page components compute access server-side and pass `state: "token" | "connected" | "not-connected" | "setup"` (+ `username`, `connectedAt`) as props.

- [ ] **Step 1: Failing source tests:** `DiscogsCard.tsx` contains each state's copy from the spec, `action="/api/discogs/connect"` and `action="/api/discogs/disconnect"` with `method="post"`, and "This app only reads from Discogs. It doesn't list, buy or message for you."; `DiscogsNotice.tsx` has the four notice texts, `role="status"`, `replaceState`; `app/settings/page.tsx` renders `<DiscogsCard` before the Account section; `app/page.tsx` renders `<ConnectCard` when not connected; `Lookup.tsx` handles `"not-connected"` with `ConnectCard`; the lot notice text "Not connected to Discogs: records will be priced once you connect."; `ErrorCard` titles include `"not-connected"`.
- [ ] **Step 2: Run** `node --experimental-strip-types --no-warnings --test tests/connect-ui.test.ts` — FAIL.
- [ ] **Step 3: Implement**, reusing `.card`, `.notice`, `button[type=submit]`, `button.secondary`; any new CSS uses tokens.
- [ ] **Step 4: Run** — PASS; `npm test` (theme, font, motion, structure tests included), `npm run typecheck` green.
- [ ] **Step 5: Commit** `feat(oauth): Discogs account card, Connect prompts and notices`

### Task 8: `setup:fly --app` asks for consumer keys; docs

**Files:** Modify `lib/setup-fly.ts` (`Answers` gains `consumerKey?`, `consumerSecret?`; `planSecrets` emits `DISCOGS_CONSUMER_KEY`/`DISCOGS_CONSUMER_SECRET`), `scripts/setup-fly.ts` (with `--app`: ask consumer key and secret instead of the token), `tests/setup-fly.test.ts`, `DEPLOY.md` §10, `CLAUDE.md` (decision line about the token, Layout entries, Status line), `.env.example` if present

- [ ] **Step 1: Failing tests:** `planSecrets` with consumer answers sets both names and no `DISCOGS_TOKEN`; with a token answer, unchanged behaviour.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement** + docs (runbook: first visit is log in → Connect Discogs; remove the "never use your token" warning; local `.env.local` with consumer vars tests the flow).
- [ ] **Step 4: Run** `npm test`, `npm run typecheck` — green. **Step 5: Commit** `feat(oauth): setup:fly sets consumer keys for shop apps; docs`

### Task 9: End-to-end check (with the owner)

- [ ] **Step 1:** Migration 7 against the local production copy: `DATA_DIR=data/prod-copy` (DEPLOY.md §9) — app boots, `pragma user_version` 7, collections intact.
- [ ] **Step 2:** `next dev` with consumer vars and no `DISCOGS_TOKEN` (temporarily commented out in `.env.local`): owner logs in, presses Connect, approves; Settings shows "Connected as <username>"; price BLP 1577 (spec live check 3: suggestions, release, versions all answer); Disconnect → the next lookup shows the Connect card.
- [ ] **Step 3:** Restore `.env.local`; record results in the spec Status; commit `docs: Connect Discogs status`.

# Collection Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add saved "lots" that price many records at once, with a server-side lookup queue, a to-pick queue for
ambiguous pressings, and running market totals, usable on phone and desktop.

**Architecture:**
- Two SQLite tables (migration 1).
- A data layer, `lib/collection/store.ts`, of plain functions that take a `DatabaseSync`.
- Pure view and parse modules.
- One in-process worker loop that shares the existing throttled Discogs client.
- REST route handlers behind the existing gate, each also calling `requireSession`.
- Client pages under `app/collection/` that poll `GET /api/sessions/:id`.

Prices are calculated when read, from the stored per-grade suggestions, using the existing `priceRecord`.

**Tech Stack:** Next.js 15.5 App Router, TypeScript, `node:sqlite`, `node:test`, plain CSS, and `barcode-detector`
(the one new dependency, lazy-loaded).

**Spec:** `docs/superpowers/specs/2026-10-04-collection-mode-design.md`

## Global Constraints

- Only new runtime dependency: `barcode-detector` (`^3`), imported dynamically from the Scan component only.
  Otherwise use Node built-ins.
- Imports use explicit `.ts`/`.tsx` extensions (`allowImportingTsExtensions`).
- Error responses use the existing shape `{ status: "error", kind, message }`, with kinds `bad-request` 400,
  `not-found` 404, `auth` 401, `missing-env` 503, `settings` 500.
- Every collection route calls `requireSession(request)` before doing anything else.
- Limits:
  - query: trimmed, 1–64 chars
  - lot name: 1–80 chars, default `Lot <Mon D>` from `toLocaleDateString("en-US", { month: "short", day: "numeric" })`
  - year: null or an integer from 1890 to 2100
  - paste: 1–500 lines
  - request body: 64 KB, or 128 KB for `POST /api/sessions/:id/items`
- Timings:
  - polling every 2 s while `queue.pending > 0`, otherwise 15 s, and none while the tab is hidden
  - offline retry every 5 s
  - Undo bar for 6 s
  - the same scanned code is ignored for 3 s
  - `etaSeconds = Math.round(pending * 3 * 1.1)`
- Exactly one worker loop per process (a `globalThis` guard). The worker writes only lookup columns, never grades,
  year or query.
- UI: reuse the tokens in `app/globals.css`. Visible labels, 16px inputs, 44px controls at 480px wide or less,
  status shown with text and an icon (never color alone), focus visible, and spinners that respect
  `prefers-reduced-motion`.
- `npm test`, `npm run typecheck` and `npx next build` pass after every task.

## Review Focus

1. **Racing the worker.** `kickWorker()` can be called twice at once, or while a loop is running. Each pending row
   must be processed exactly once, oldest first. Test in Task 3.
2. **Deleting under the worker.** A row or lot deleted while its row is `working`: the worker's write must update
   nothing and must not throw or bring the row back. Test in Task 3.
3. **Grades changed during a lookup.** A grade change on a `working` row must survive the worker's write, so
   `applyLookup` touches only lookup columns. Test in Task 1 (store) and Task 3 (worker).
4. **Messy pasted text.** `\r\n` line endings, a leading BOM, trailing commas (`SD 7208,`), and full-width or extra
   spaces all parse cleanly with no phantom rows. Test in Task 2.
5. **`settings.json` invalid at read time.** `GET /api/sessions/:id` returns a 500 with kind `settings`, not an
   unhandled throw. Test in Task 4.

---

### Task 1: Schema and data layer

**Files:**
- Modify: `lib/migrations.ts` (append migration 1)
- Create: `lib/collection/types.ts`, `lib/collection/store.ts`
- Test: `tests/db.test.ts` (extend), `tests/collection-store.test.ts`

**Interfaces:**
- Produces, from `lib/collection/types.ts`:
  - `type ItemStatus = "pending" | "working" | "to-pick" | "priced" | "no-match" | "no-price" | "error"`
  - `type SessionRow = { id: number; name: string; defaultRecord: Grade; defaultSleeve: Grade; createdAt: number; updatedAt: number }`
  - `type ItemRow = { id: number; sessionId: number; query: string; year: number | null; record: Grade; sleeve: Grade; status: ItemStatus; releaseId: number | null; release: Candidate | null; candidates: Candidate[] | null; suggestions: PriceSuggestions | null; stats: MarketplaceStats | null; pricedAt: number | null; error: string | null; createdAt: number }`
  - `type LookupPatch = { status: Exclude<ItemStatus, "working">; releaseId?: number | null; release?: Candidate | null; candidates?: Candidate[] | null; suggestions?: PriceSuggestions | null; stats?: MarketplaceStats | null; pricedAt?: number | null; error?: string | null }`
  - `type NewLine = { query: string; year?: number }`
- Produces, from `lib/collection/store.ts` (every function takes `db: DatabaseSync` first; JSON columns are parsed
  into objects):
  - `createSession(db, input: { name: string; defaultRecord: Grade; defaultSleeve: Grade }, now: number): SessionRow`
  - `listSessions(db): SessionRow[]`, ordered by `updatedAt` descending
  - `getSession(db, id): SessionRow | null`
  - `updateSession(db, id, patch: { name?: string; defaultRecord?: Grade; defaultSleeve?: Grade }, now): SessionRow | null`
  - `deleteSession(db, id): boolean`
  - `touchSession(db, id, now): void`
  - `addItems(db, sessionId, lines: NewLine[], grades: { record: Grade; sleeve: Grade }, now): ItemRow[]`: status
    `pending`, in one transaction, returned in insertion order
  - `listItems(db, sessionId): ItemRow[]`, newest first (`created_at DESC, id DESC`)
  - `getItem(db, id): ItemRow | null`
  - `updateItemFields(db, id, patch: { record?: Grade; sleeve?: Grade; year?: number | null }): ItemRow | null`.
    Changing `year` to a different value resets the row to a fresh search: status `pending`, and `release_id`,
    `release_json`, `candidates_json`, `suggestions_json`, `stats_json`, `priced_at` and `error` cleared.
  - `pickRelease(db, id, releaseId): ItemRow | "not-found" | "invalid"`. The release must be in `candidates` and the
    status must be `to-pick`. On success it sets `release_id`/`release_json`, clears `candidates_json`, and sets
    status `pending`.
  - `retryItem(db, id): ItemRow | "not-found" | "invalid-state"` (only from `error`/`no-match`, giving `pending`;
    `error` is cleared)
  - `repriceSession(db, sessionId): number`: rows that are `priced`/`no-price` and have a `release_id` become
    `pending`; suggestions and stats are kept
  - `deleteItem(db, id): boolean`
  - `claimNextPending(db): ItemRow | null`: the oldest `pending` row across all lots, by `created_at, id`, set to
    `working` and returned
  - `applyLookup(db, id, patch: LookupPatch): boolean`: `UPDATE … WHERE id = ? AND status = 'working'`, touching only
    the patch's lookup columns. Returns false if 0 rows changed.
  - `resetWorking(db): number` (`working` back to `pending`)
  - `countPending(db): number` (`pending` + `working`)

- [ ] **Step 1: Write failing tests.**
  - `tests/db.test.ts`: on a fresh `:memory:` database (via `openDb`), `user_version` is 1, the tables `sessions`
    and `items` and the indexes `items_session` and `items_status` exist, and deleting a session cascades to its
    items.
  - `tests/collection-store.test.ts`, using `openDb(":memory:")`:
    - create, get, update and list sessions, with list ordering by `updatedAt`
    - `addItems` returns pending rows with grades, and `listItems` returns them newest first
    - `claimNextPending` claims oldest first across two lots and returns null when none are left
    - `applyLookup` on a `working` row writes the patch. After `updateItemFields(record: "NM")` on a working row,
      `applyLookup` keeps `NM` (Review Focus 3).
    - `applyLookup` returns false on a deleted row and on a row that isn't `working`
    - `pickRelease`: valid id gives `pending` with release set and candidates cleared; an id not in candidates gives
      `"invalid"`; a row not in `to-pick` gives `"invalid"`; an unknown row gives `"not-found"`
    - `retryItem` only from `error`/`no-match`
    - `repriceSession` keeps suggestions and moves only priced/no-price rows
    - a year change resets the lookup columns, while a grade change doesn't
    - `resetWorking` and `countPending`
- [ ] **Step 2: Run** `npm test`. Expected: the new tests fail (no tables yet, or the module is missing).
- [ ] **Step 3: Append migration 1** with the exact SQL from spec §1 (both tables, both indexes, the `status` CHECK),
  as a single string in the `migrations` array.
- [ ] **Step 4: Implement** `lib/collection/types.ts` and `lib/collection/store.ts`, using prepared statements and
  mapping snake_case columns to the camelCase types.
- [ ] **Step 5: Run** `npm test` and `npm run typecheck`. Expected: all pass.
- [ ] **Step 6: Commit:** `git add lib tests && git commit -m "feat(collection): schema and data layer"`

---

### Task 2: Pure parse and view logic

**Files:**
- Create: `lib/collection/parse.ts`, `lib/collection/view.ts`, `lib/collection/ui.ts`
- Test: `tests/collection-parse.test.ts`, `tests/collection-view.test.ts`

**Interfaces:**
- Consumes: `ItemRow`, `NewLine` (Task 1); `priceRecord` and `Settings` (existing)
- Produces:
  - `parseBulkLines(text: string): { lines: NewLine[]; errors: { line: number; reason: string }[] }`
  - `type Market = { low: number; suggested: number; high: number }`
  - `marketFor(item: ItemRow, settings: Settings): Market | null`, which returns null without suggestions or when
    `priceRecord` returns null
  - `type ItemView = { id: number; query: string; year: number | null; record: Grade; sleeve: Grade; status: Exclude<ItemStatus, "working"> | "looking-up"; release: Candidate | null; candidateCount: number; market: Market | null; stats: MarketplaceStats | null; pricedAt: number | null; error: string | null }`
  - `toItemView(item: ItemRow, settings: Settings): ItemView`
  - `type Totals = { low: number; suggested: number; high: number; total: number; priced: number; toPick: number; noPrice: number; problems: number; pending: number }`
  - `computeTotals(items: ItemRow[], settings: Settings): Totals`, where `priced` counts rows with
    `marketFor !== null`, including pending or working rows that still hold old suggestions
  - `type QueueState = { pending: number; paused: boolean; etaSeconds: number }`
  - `queueState(pending: number, paused: boolean): QueueState`
  - From `lib/collection/ui.ts` (client-safe, no Node imports):
    - `defaultLotName(now: Date): string` (`"Lot Oct 4"`)
    - `pollDelayMs(pending: number): number` (2000 or 15000)
    - `createScanFilter(windowMs = 3000): (code: string, now: number) => boolean`, which returns false for the same
      code within the window

**Parse rules** (spec §3):
- Strip a leading BOM. Split on `/\r?\n/`. Trim each line and collapse runs of whitespace (including U+3000 and
  U+00A0) to a single space. Skip empty lines.
- If the line contains `,` or `\t`, split at the **last** one. If the tail is empty, use the head as the query with
  no year (`SD 7208,`). If the tail is a valid year, it's the year. Otherwise the line is an error
  ("year must be 1890–2100").
- A query longer than 64 chars is an error.
- After 500 valid lines, stop and add one error: `{ line: <n>, reason: "only the first 500 records are added" }`.
- `line` numbers are 1-based over the original text.

- [ ] **Step 1: Write failing tests.**
  - Parse:
    - `"SD 7208, 1971"`, `"SD 7208\t1971"`, `"ST 2001"` (no year), `"Smith, John, 1971"` (query `"Smith, John"`)
    - `"SD 7208, 71"` is an error on line 1
    - `"﻿A 1\r\n\r\nB 2,\r\n"` gives `[A 1, B 2]` with no errors (Review Focus 4)
    - full-width spaces collapse
    - a 65-char query is an error
    - 501 lines give 500 lines plus the cap error
  - View, built from `settings.json` via `parseSettings`:
    - `marketFor` matches `priceRecord(...).market` for the same inputs
    - a missing grade gives null
    - `toItemView` maps `working` to `looking-up` and sets `candidateCount`
    - `computeTotals` over a mix of priced, to-pick, no-match, error, no-price, pending-with-suggestions and
      pending-without-suggestions rows gives the exact sums and counts
    - `queueState(10, false).etaSeconds === 33`
    - `defaultLotName(new Date(2026, 9, 4)) === "Lot Oct 4"`
    - `pollDelayMs(1) === 2000`, `pollDelayMs(0) === 15000`
    - the scan filter: same code at 0 and 2999 gives true then false; at 3000 it gives true; a different code always
      gives true
- [ ] **Step 2: Run** `npm test` and confirm the new tests fail (module missing).
- [ ] **Step 3: Implement** the three modules.
- [ ] **Step 4: Run** `npm test` and `npm run typecheck`. Expected: pass.
- [ ] **Step 5: Commit:** `git add lib tests && git commit -m "feat(collection): bulk parser, pricing view, ui helpers"`

---

### Task 3: Shared Discogs client and lookup worker

**Files:**
- Create: `lib/discogs-client.ts`, `lib/collection/worker.ts`, `instrumentation.ts`
- Modify: `app/api/lookup/route.ts` (use `getDiscogsClient()` and delete its local `client()`)
- Test: `tests/collection-worker.test.ts`

**Interfaces:**
- Consumes: the store functions (Task 1); `LookupClient` (`lib/lookup.ts`); `DiscogsError` (`lib/discogs.ts`);
  `missingEnv`
- Produces:
  - `getDiscogsClient(): DiscogsClient`: the same `globalThis.__discogsClient` singleton and constructor arguments as
    the current route
  - `processItem(client: LookupClient, item: ItemRow, now: number): Promise<LookupPatch & { pauseQueue?: true }>`
  - `type WorkerDeps = { db?: DatabaseSync; client?: LookupClient; now?: () => number }`, defaulting to `getDb()`,
    `getDiscogsClient()` and `Date.now`
  - `kickWorker(deps?: WorkerDeps): Promise<void>`: returns the running loop's promise, and starts one if idle and
    not paused
  - `isQueuePaused(): boolean`, `resumeQueue(): void`
  - `startWorkerOnBoot(): void`: does nothing if `missingEnv(process.env)` is non-empty; otherwise runs
    `resetWorking(getDb())`, then `kickWorker()`
  - `__resetWorkerForTests(): void`: clears the loop and pause flags

**`processItem` rules** (spec §1 table):
- **No `releaseId`:** call `client.searchByCatno(item.query, item.year ?? undefined)`.
  - 0 results: `no-match`.
  - More than 1: `to-pick` with `candidates`.
  - Exactly 1: price that release in the same call.
- **Pricing:** `Promise.all([priceSuggestions(id), marketplaceStats(id)])`.
  - Null suggestions, or none for `item.record`: `no-price`, with `stats`, `suggestions` (possibly null) and
    `pricedAt`.
  - Otherwise `priced`, with `suggestions`, `stats` and `pricedAt: now`.
  - Searching then pricing in one call sets `releaseId`/`release` to the single candidate and `candidates: null`.
- **Errors:**
  - `DiscogsError` with status 401: `{ status: "error", error: "Discogs rejected the token", pauseQueue: true }`.
  - Any other error: `{ status: "error", error: <message, at most 200 chars> }`.

**Loop:**
1. While not paused, `claimNextPending`. If it returns null, stop.
2. Call `processItem` and `applyLookup` (ignore a false result).
3. `touchSession(item.sessionId)`.
4. If the patch has `pauseQueue`, set paused and stop.

The loop catches its own errors so it never leaves an unhandled rejection.

- [ ] **Step 1: Write failing `tests/collection-worker.test.ts`.** Use `openDb(":memory:")` and a fake
  `LookupClient` that records its calls and returns scripted results, and call `__resetWorkerForTests()` in
  `beforeEach`.
  - No match, several matches, one match then priced (the call order is search, then suggestions, then stats).
  - No price data; a grade missing from the suggestions gives `no-price`.
  - `DiscogsError(…, 502)` gives an error with a message, and the loop continues to the next row.
  - A 401 gives an error and `isQueuePaused()`. A second kick doesn't process anything. `resumeQueue()` plus a kick
    processes the rest.
  - Two concurrent `kickWorker()` calls with 3 pending rows: the fake sees exactly 3 searches, in creation order
    (Review Focus 1).
  - An item deleted while the fake search is awaiting (delete it inside the fake): no throw, and the row stays
    deleted (Review Focus 2).
  - A grade changed during the fake search survives the write (Review Focus 3).
  - `resetWorking` together with a kick processes a row left `working`.
- [ ] **Step 2: Run** `npm test` and confirm the new tests fail.
- [ ] **Step 3: Implement** `lib/discogs-client.ts` and point `app/api/lookup/route.ts` at it. The existing
  lookup-route tests must stay green.
- [ ] **Step 4: Implement** `lib/collection/worker.ts`, and `instrumentation.ts`:
  `export async function register() { if (process.env.NEXT_RUNTIME === "nodejs") (await import("./lib/collection/worker.ts")).startWorkerOnBoot(); }`
- [ ] **Step 5: Run** `npm test`, `npm run typecheck` and `npx next build`. Expected: pass. The build must not try to
  bundle `node:sqlite` into the instrumentation edge bundle; if it does, use the `NEXT_RUNTIME` guard with a dynamic
  import as above.
- [ ] **Step 6: Commit:** `git add lib app instrumentation.ts tests && git commit -m "feat(collection): shared discogs client and lookup worker"`

---

### Task 4: Collection API routes

**Files:**
- Create: `lib/route-auth.ts`, `lib/collection/http.ts`, and the route handlers:
  - `app/api/sessions/route.ts`
  - `app/api/sessions/[id]/route.ts`
  - `app/api/sessions/[id]/items/route.ts`
  - `app/api/sessions/[id]/reprice/route.ts`
  - `app/api/items/[id]/route.ts`
  - `app/api/items/[id]/retry/route.ts`
  - `app/api/items/[id]/candidates/route.ts`
- Modify: `app/api/lookup/route.ts` (replace its inline session check with `requireSession`)
- Test: `tests/collection-routes.test.ts`

**Interfaces:**
- Consumes: Tasks 1–3; `authMode`, `verifySession`, `SESSION_COOKIE` (`lib/auth.ts`); `loadSettings`; `isGrade`
- Produces:
  - `requireSession(request: Request): Promise<Response | null>`: the exact behavior of the current lookup-route
    check (503 `missing-env` when login is misconfigured, 401 `auth` without a valid cookie, null when allowed),
    including its strict `cookieValue` parsing
  - From `lib/collection/http.ts`:
    - `errorJson(kind: string, status: number, message: string): Response`
    - `readJson(request: Request, maxBytes: number): Promise<{ ok: true; value: unknown } | { ok: false; response: Response }>`:
      a Content-Length above `maxBytes` or invalid JSON gives 400
    - `parseId(raw: string): number | null`, which accepts positive integers only
    - `withSettings<T>(fn: (s: Settings) => T): T | Response`, returning a 500 `settings` response on a load error.
      It loads `settings.json` through `loadSettings(path?)`.
    - `__setSettingsPathForTests(path: string | null): void`, which overrides the path `withSettings` loads; null
      restores the default
  - Handlers, with the shapes from spec §3. Next 15 dynamic params are passed as
    `{ params }: { params: Promise<{ id: string }> }`.
  - `GET /api/sessions` returns
    `{ sessions: [{ id, name, updatedAt, itemCount, suggested, defaultRecord, defaultSleeve }] }`.
  - `GET /api/sessions/:id` returns `{ session, items: ItemView[], totals: Totals, queue: QueueState }`.
  - Every mutating handler that creates pending rows (`POST items`, `PATCH item` with `releaseId` or a year change,
    `retry`, `reprice`) calls `void kickWorker()` afterwards. `retry` also calls `resumeQueue()` first.
  - `PATCH /api/items/:id` with `releaseId` maps `pickRelease` results: `"invalid"` gives 400, `"not-found"` gives
    404.
  - `GET /api/items/:id/candidates` returns `{ candidates: Candidate[] }`, or 404 when the row has none.

- [ ] **Step 1: Write failing `tests/collection-routes.test.ts`.**
  - Setup:
    - set `APP_PASSWORD_HASH`/`SESSION_SECRET` and a signed cookie, and restore env afterwards
    - set `globalThis.__mintDb = openDb(":memory:")` before calling any handler
    - set `globalThis.__discogsClient` to a fake implementing `LookupClient`
    - call `__resetWorkerForTests()` in `beforeEach`
  - Cases:
    - every handler returns 401 without a cookie
    - create a lot, using the default name when `name` is omitted, then list and get it
    - rename; reject an 81-char name with 400; reject a bad grade with 400
    - add 3 lines, then `await kickWorker()`, and get shows the statuses and totals from the fake
    - add 501 lines gives 400; a 64 KB+ body on PATCH gives 400
    - pick a valid release gives a pending row, and after the worker it's priced; an invalid release gives 400
    - candidates route returns the list, and 404 once the row is resolved
    - retry from error gives pending
    - reprice returns `{ queued }`
    - delete item, then delete lot, then get gives 404
    - a bad id (`abc`, `0`) gives 400
    - with `settings.json` loading forced to fail (point `withSettings` at a bad path through an exported test hook,
      `__setSettingsPathForTests`), get gives a 500 `settings` response (Review Focus 5)
- [ ] **Step 2: Run** `npm test` and confirm the new tests fail.
- [ ] **Step 3: Implement** `lib/route-auth.ts` and switch `app/api/lookup/route.ts` to it, keeping the
  lookup-route tests green. Then implement `lib/collection/http.ts` and the handlers.
- [ ] **Step 4: Run** `npm test`, `npm run typecheck` and `npx next build`.
- [ ] **Step 5: Smoke test locally.** With `npm run dev` and no `APP_*` variables (login off), use curl with
  `-H "Origin: http://localhost:3000"` on POSTs to create a lot, add `SD 7208, 1971`, and poll get until the row
  isn't pending. Expected: the row reaches `to-pick` or `priced` from live Discogs. Stop the server afterwards.
- [ ] **Step 6: Commit:** `git add lib app tests && git commit -m "feat(collection): REST API for lots and items"`

---

### Task 5: Shared UI pieces, navigation, and the lots list

**Files:**
- Create: `app/Picker.tsx` (move `Picker` and `Thumb` out of `Lookup.tsx`, exporting both), `app/GradeSelect.tsx`
  (move `GradeSelect`), `app/SiteHeader.tsx` (server), `app/NavLinks.tsx` (client), `app/collection/page.tsx`,
  `app/collection/LotsList.tsx`
- Modify: `app/Lookup.tsx` (import the moved components), `app/page.tsx` (use `SiteHeader` instead of its inline
  masthead/LogoutButton), `app/globals.css`

**Interfaces:**
- Consumes: `defaultLotName` (Task 2); `GET`/`POST /api/sessions` (Task 4); `authMode` (`lib/auth.ts`)
- Produces:
  - `<Picker candidates year? onPick />` and `<Thumb src />`, with unchanged behavior. `Picker` gains an optional
    `autoFocusFilter?: boolean`, default false.
  - `<GradeSelect id value onChange label? />`, where `label` is an optional visually hidden label for use in rows.
  - `<SiteHeader />`: the brand, `NavLinks` ("Price a record" `/`, "Lots" `/collection`, with the active link marked
    through `usePathname` and `aria-current="page"`), and `LogoutButton` when `authMode(process.env).mode === "on"`.
    Every page using it exports `dynamic = "force-dynamic"`.

- [ ] **Step 1: Do the extraction refactor.** Move the components with no behavior change, then run `npm test` and
  `npx next build` (both must stay green). Load `/` in `npm run dev` and confirm a lookup still works.
- [ ] **Step 2: Build `SiteHeader`, `NavLinks` and the header CSS,** in a single row on desktop and wrapping at 480px
  or less.
- [ ] **Step 3: Build `/collection`.**
  - A **New lot** card: a name input prefilled with `defaultLotName(new Date())`, default record and sleeve grades
    (VG+/VG+), and **Create**, which POSTs and then calls `router.push("/collection/<id>")`.
  - The list: name, relative updated date, item count, suggested total (`Intl.NumberFormat` USD), each linking to the
    lot.
  - An empty state: "No lots yet. Create one to start pricing a collection."
  - Loading and error states. A 401 calls `location.assign("/login?next=/collection")`.
- [ ] **Step 4: Verify.** Run `npm test`, `npm run typecheck` and `npx next build`. In `npm run dev`, curl
  `/collection` and get 200, then create a lot through the API and confirm it appears (curl the API's list).
- [ ] **Step 5: Commit:** `git add app && git commit -m "feat(collection): shared components, nav header, lots list"`

---

### Task 6: The lot page

**Files:**
- Create: in `app/collection/[id]/`: `page.tsx` (server shell: `SiteHeader` plus `<LotView id />`), `LotView.tsx`,
  `TotalsBar.tsx`, `EntryBar.tsx`, `PasteList.tsx`, `ItemRow.tsx`, `PickPanel.tsx`
- Modify: `app/globals.css`

**Interfaces:**
- Consumes: the Task 4 API; `pollDelayMs`, `parseBulkLines` (Task 2, client-safe); `Picker`, `Thumb`, `GradeSelect`
  (Task 5); `ItemView`, `Totals`, `QueueState` types. Use type-only imports from server modules.
- Produces: the lot page as described in spec §4, matching the approved mockup. Scan comes in Task 7; this task
  renders a Scan button placeholder with `hidden` until Task 7 wires it.

**Behavior to implement** (spec §4; every value from Global Constraints):
- **Polling:** `LotView` fetches `GET /api/sessions/:id` and schedules the next fetch with `pollDelayMs`. It pauses
  on `visibilitychange` when hidden and refetches immediately when visible again.
  - A failed fetch shows "Offline, retrying" and retries every 5 s.
  - 404 shows "Lot not found" with a link to `/collection`.
  - 401 calls `location.assign("/login?next=/collection/<id>")`.
- **TotalsBar** (sticky, `position: sticky; top: 0`):
  - Low / Suggested / High in tabular figures
  - coverage line: `"<priced> of <total> priced · <toPick> to pick · <noPrice> no price · <problems> error"`,
    omitting zero parts after "priced"
  - queue line: `"Looking up · <pending> left · ~<eta>"`, with eta formatted as "5 sec" or "2 min"
  - a paused banner: "Discogs rejected the token. Fix it, then press Retry on a row."
  - at 480px or less, collapsed to Suggested and `"<priced>/<total>"`, as a button with `aria-expanded` that expands
    on tap
- **EntryBar:**
  - Fields: query (autofocus), year, Record, Sleeve (initialized from the lot defaults and kept between adds), Add.
  - Enter in query or year submits. Submit POSTs one line, then clears query and year and re-focuses the query.
  - On failure it keeps the text and shows an inline error with `aria-describedby`.
  - A **Paste a list** toggle reveals `PasteList`: a textarea, a live `parseBulkLines` preview
    ("23 records, 1 line skipped: line 4"), and **Add 23 records**, which POSTs the parsed lines with the current
    grades and then clears.
- **Filters:** All / To pick (n) / Problems (n), as buttons with `aria-pressed`.
- **ItemRow:**
  - Content: thumb, title, `label · catno · country · year · format` (or the query and year before a release is
    known), Record and Sleeve `GradeSelect` (a change PATCHes immediately and shows an optimistic value), market
    suggested with low–high beneath, and a status label with an icon and text.
  - The market value is dimmed while `status` is `pending` or `looking-up` with a market present.
  - Actions: **Pick pressing** (to-pick), **Retry** (error/no-match), **Remove** (all).
  - Remove: DELETE, then show the Undo bar for 6 s. Undo POSTs the same query, year and grades.
- **PickPanel:**
  - A dialog (`role="dialog"`, `aria-modal`, labelled by its heading). Escape and ✕ close it, focus is trapped, and
    focus returns to the trigger on close.
  - Loads `GET /api/items/:id/candidates` and renders `Picker` (with `year` set to the row's year).
  - A pick PATCHes `{ releaseId }`, closes, and focuses the next to-pick row's Pick button, or the query field if
    none are left.
  - Shown as a right-side panel on desktop and a bottom sheet at 480px or less.
- **Header:**
  - The name is an inline-editable field: Enter or blur saves via PATCH, Escape cancels.
  - Shows the defaults.
  - **Re-price all** POSTs reprice.
  - **Delete lot** confirms in a dialog, then DELETEs and goes to `/collection`.
- **Phones (480px or less):** rows become cards (grid areas), full-width 44px inputs, and Scan and Add side by side.

- [ ] **Step 1: Build the components** and CSS, following the approved mockup.
- [ ] **Step 2: Verify.** Run `npm test`, `npm run typecheck` and `npx next build`. In `npm run dev` with login off:
  - curl `/collection/<id>` returns 200 and `/collection/999999` renders the not-found state
  - use the API to add 3 rows and confirm through get that they progress
  - record in the report which UI paths you could not exercise without a browser
- [ ] **Step 3: Commit:** `git add app && git commit -m "feat(collection): lot page with totals, entry, paste, rows, picker"`

---

### Task 7: Camera scanning

**Files:**
- Create: `app/collection/[id]/Scanner.tsx`
- Modify: `package.json` and `package-lock.json` (`npm install barcode-detector@^3`), `EntryBar.tsx` (wire up Scan),
  `app/globals.css`

**Interfaces:**
- Consumes: `createScanFilter` (Task 2); the add-items call from `LotView` (pass in an `onCode(code: string)` that
  adds one line with the current grades and returns the resulting `ItemView`)
- Produces: `<Scanner grades={{ record, sleeve }} onCode onClose />`, full screen

**Behavior:**
- **Showing the Scan button:** only when `navigator.mediaDevices?.getUserMedia` exists. The button hides itself if
  loading the detector fails.
- **Choosing a detector:** if `"BarcodeDetector" in window` and
  `(await BarcodeDetector.getSupportedFormats())` includes `"ean_13"`, use the native one. Otherwise use
  `(await import("barcode-detector/ponyfill")).BarcodeDetector`. Both use formats
  `["ean_13", "ean_8", "upc_a", "upc_e"]`. Use the package's default WASM loading.
- **Camera:** `getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false })` into a
  `<video playsInline muted autoPlay>`. Detect every 250 ms with `setTimeout`, never overlapping.
- **On a read:** if the scan filter returns true, call `navigator.vibrate?.(60)` and `onCode(rawValue)`. Show
  "Added <code> · keep scanning" in an `aria-live` region, and keep a list of this scan session's codes with their
  returned status.
- **Permission denied** (`NotAllowedError`): show "Camera blocked. Allow camera access for this site in your browser
  settings, or type the number instead." with a Close button.
- **Done and Escape:** stop every track, clear the timer, and call `onClose`. Clean up on unmount.
- **Header:** shows `Scanning · <record> / <sleeve>`.

- [ ] **Step 1: Install** `barcode-detector`. Confirm it is in `dependencies` and that `npx next build` doesn't
  include it in the first-load JS of `/collection/[id]` (compare the route size before and after; it should be a
  separate chunk).
- [ ] **Step 2: Build `Scanner.tsx`** and wire it in. The component is `next/dynamic`-imported with `ssr: false` from
  `EntryBar`.
- [ ] **Step 3: Run** `npm test`, `npm run typecheck` and `npx next build`. Record the route sizes in the report.
  Camera behavior can only be checked on a real device; the controller does that with the user in Task 8.
- [ ] **Step 4: Commit:** `git add package.json package-lock.json app && git commit -m "feat(collection): camera barcode scanning"`

---

### Task 8: Docs and rollout

**Files:**
- Modify: `CLAUDE.md` (layout, status, collection decisions, and "Phase 4" moved from Later phases into Status),
  `README.md` (replace the roadmap's "in progress" entry with a **Collection mode** usage section, and keep the
  remaining roadmap items)

- [ ] **Step 1: Update the README.**
  - Add a usage section covering creating a lot, the four ways to add records, to-pick, totals and coverage,
    re-price, and that lots sync across devices.
  - Update the layout block with `app/collection/` and `lib/collection/`.
- [ ] **Step 2: Update CLAUDE.md** (concise, matching its style), then commit:
  `git commit -am "docs: collection mode"`.
- [ ] **Step 3: Rollout (controller, with the user).**
  - Open a PR, then merge it, which deploys through the workflow; watch the run.
  - Check `/api/health` returns 200, and run one API smoke test (create a lot, add a line, check it progresses),
    then delete the smoke-test lot.
- [ ] **Step 4: Phone check (user, on mobile data).**
  - Create a lot and add 5 records: 2 typed, 2 scanned, 1 pasted.
  - Pick one pressing and confirm the totals.
  - Record the result in CLAUDE.md Status and commit.

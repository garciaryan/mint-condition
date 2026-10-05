# Discogs Response Cache Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Answer repeat Discogs requests from SQLite for `discogs.cacheHours`, with Re-price / Retry / Refresh bypassing the cache and the UI showing the age of cached prices.

**Architecture:** Migration 4 adds `discogs_cache` and `items.refresh`. `CachedClient` (`lib/discogs-cache.ts`) wraps the
existing `LookupClient` shape and returns `{ value, fetchedAt }`; `getLookupClient()` builds one per call around the
shared throttled `DiscogsClient`. `runLookup` and the worker consume it; the single-record card and the lot header
show ages.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, `node:sqlite`, Node's built-in test runner.

**Spec:** `docs/superpowers/specs/2026-10-04-discogs-cache-design.md`

## Global Constraints

- No new dependencies. Tests: `node:test` + `node:assert/strict` in `tests/*.test.ts`; non-test helpers in `tests/helpers/`.
- `lib/discogs.ts`, `lib/pricing.ts`, `lib/offer.ts` are not modified.
- Migrations are append-only; migration 4 is the next string in `migrations`.
- Errors from Discogs are never cached; a cache read/write failure never fails a lookup (log with `console.error`).
- The worker writes only lookup columns (plus clearing `refresh`), never grades, year or query.
- Copy, verbatim: single-record "Prices from <age> · Refresh prices"; lot header "Oldest prices: <age>"; settings
  field "Cache prices for (hours)"; leave-guard `confirm("You have unsaved changes. Leave without saving?")`;
  validation `settings: discogs.cacheHours must be an integer from 0 to 168`.
- Keep `npm test` and `npm run typecheck` green after every task. Single file:
  `node --experimental-strip-types --no-warnings --test tests/<file>.test.ts`

## Review Focus

1. A cache row whose `fetched_at` is in the future (clock moved back) must not be a hit forever: a hit needs
   `0 <= now - fetched_at < ttl`. (Task 2.)
2. `cacheHours()` throwing (bad `settings.json` or DB) inside the worker must not fail every item: treat it as 0
   (no cache), log once per call. (Task 2.)
3. A release cached as "no suggestions" (seller account not set up yet) stays stuck for a day unless the user can
   refresh: the Refresh link shows on cached `no-price` results too. (Task 5.)
4. Retry on a `no-match` row must search fresh, or the cached empty search returns instantly forever. (Task 4.)
5. Tests share `globalThis` clients: `getLookupClient()` must not capture a stale inner client, so it builds a new
   (stateless) `CachedClient` per call around `getDiscogsClient()`. (Task 2.)

---

### Task 1: `cacheHours` setting and field

**Files:**
- Modify: `lib/settings.ts` (validate `discogs.cacheHours`)
- Modify: `lib/settings-form.ts` (add `"discogs.cacheHours"` to `FIELD_KEYS` at the end, rule: whole number 0–168, kind `"hours"` formatted as a plain number; `EditableSettings` gains `discogs: { cacheHours: number }`)
- Modify: `app/settings/SettingsForm.tsx` (new **Discogs** section with the field labelled "Cache prices for (hours)", `inputMode="numeric"`; the currency line moves into this section, replacing its separate card)
- Test: `tests/settings.test.ts`, `tests/settings-form.test.ts`, `tests/settings-store.test.ts`

**Interfaces:**
- Produces: `Settings.discogs.cacheHours` guaranteed an integer in [0, 168] after `parseSettings`; `FieldKey` includes `"discogs.cacheHours"`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/settings.test.ts
test("discogs.cacheHours is a whole number from 0 to 168", () => {
  const withHours = (h: unknown) => ({ ...base, discogs: { ...base.discogs, cacheHours: h } });
  for (const bad of [-1, 169, 1.5, "24", null]) assert.throws(() => parseSettings(withHours(bad)), /discogs\.cacheHours/);
  for (const ok of [0, 168]) assert.doesNotThrow(() => parseSettings(withHours(ok)));
});

// tests/settings-form.test.ts
test("cache hours field round-trips and is limited to 0–168 whole hours", () => {
  const f = toForm(defaults);
  assert.equal(f["discogs.cacheHours"], "24");
  assert.equal(formatDefault("discogs.cacheHours", defaults), "24");
  const r = fromForm({ ...f, "discogs.cacheHours": "0" });
  assert.ok(r.ok);
  assert.equal(r.value.discogs.cacheHours, 0);
  for (const bad of ["-1", "169", "2.5", ""]) assert.equal(fromForm({ ...f, "discogs.cacheHours": bad }).ok, false, bad);
});

// tests/settings-store.test.ts
test("cache hours are saved while currency still follows the file", () => {
  saveSettings(db, { discogs: { cacheHours: 6, currency: "EUR" } });
  const s = getSettings(db).settings;
  assert.equal(s.discogs.cacheHours, 6);
  assert.equal(s.discogs.currency, defaults.discogs.currency);
});
```

- [ ] **Step 2: Run, expect FAIL** (no validation; no field key).
- [ ] **Step 3: Implement.** Error text for the field: `"Use a whole number from 0 to 168."`. The existing "toForm covers every field key" test must still pass.
- [ ] **Step 4: Run `npm test` and `npm run typecheck`**, expect green.
- [ ] **Step 5: Commit** `feat(settings): validate and edit discogs.cacheHours`

---

### Task 2: Migration 4, `CachedClient`, `getLookupClient`

**Files:**
- Modify: `lib/migrations.ts` (migration 4, SQL from the spec's Data section)
- Create: `lib/discogs-cache.ts`
- Modify: `lib/discogs-client.ts` (add `getLookupClient`)
- Test: `tests/db.test.ts`, `tests/discogs-cache.test.ts`

**Interfaces:**
- Consumes: `LookupClient` (type, `lib/lookup.ts`), `getSettings` (`lib/settings-store.ts`), `getDb`.
- Produces (exact, from the spec): `Fetched<T>`, `FetchOpts`, `CachedLookupClient`, `class CachedClient`,
  `searchKey(query, year)`; constructor `new CachedClient(inner: LookupClient, deps: { db: () => DatabaseSync; cacheHours: () => number; now?: () => number })`.
  `getLookupClient(): CachedLookupClient` returns `new CachedClient(getDiscogsClient(), { db: getDb, cacheHours: () => getSettings(getDb()).settings.discogs.cacheHours })` on every call (stateless; all state is in SQLite).

- [ ] **Step 1: Write the failing tests**

`tests/db.test.ts`:
```ts
test("migration 4 adds discogs_cache and items.refresh to a version-3 database", () => {
  const db = new DatabaseSync(":memory:");
  migrate(db, migrations.slice(0, 3));
  db.exec("insert into sessions (id,name,default_record,default_sleeve,created_at,updated_at) values (1,'L','NM','NM',1,1)");
  db.exec("insert into items (session_id,query,record_grade,sleeve_grade,status,created_at) values (1,'x','NM','NM','pending',1)");
  assert.equal(migrate(db, migrations), 4);
  assert.deepEqual({ ...(db.prepare("select refresh from items").get() as object) }, { refresh: 0 });
  db.exec("insert into discogs_cache (key, json, fetched_at) values ('k', '1', 1)");
});
```

`tests/discogs-cache.test.ts` — a fake inner `LookupClient` that counts calls and can be told to throw; `db = openDb(":memory:")`; `let t = 1_000_000; const now = () => t; let hours = 24;` `const c = new CachedClient(inner, { db: () => db, cacheHours: () => hours, now })`. Tests:
```ts
test("a miss fetches and stores; a hit makes no inner call", async () => {
  assert.deepEqual(await c.priceSuggestions(7), { value: SUG, fetchedAt: t });
  t += 1000;
  assert.deepEqual(await c.priceSuggestions(7), { value: SUG, fetchedAt: t - 1000 });
  assert.equal(calls.filter((x) => x === "sugg:7").length, 1);
});
test("an entry exactly cacheHours old is expired", async () => {
  await c.marketplaceStats(7);
  t += 24 * 3_600_000;
  await c.marketplaceStats(7);
  assert.equal(calls.filter((x) => x === "stats:7").length, 2);
});
test("fresh bypasses the cache and overwrites the entry", async () => { /* 2 inner calls; third non-fresh call returns the second fetchedAt */ });
test("empty search and null suggestions are cached", async () => { /* inner returns [] / null; second call makes no inner call */ });
test("inner errors are not cached and an existing entry survives", async () => {
  /* fetch ok at t0; advance past ttl; inner throws DiscogsError 503 → rejects; inner ok again → fetches; and: fresh call that throws leaves the t0 row readable (non-fresh call before expiry still hits) */
});
test("cacheHours 0 neither reads nor writes", async () => { /* hours = 0; two calls → two inner calls; select count(*) from discogs_cache = 0 */ });
test("a corrupt entry is refetched and overwritten", async () => { /* insert key 'suggestions:7' json '{bad' → inner called, row now parses */ });
test("expired rows are deleted when something is written", async () => { /* write A, advance > ttl, write B → A's row gone */ });
test("a fetched_at in the future is not a hit", async () => { /* insert row with fetched_at = t + 3_600_000 → inner called */ });
test("cacheHours throwing means no cache, not a failed lookup", async () => {
  /* cacheHours: () => { throw new Error("bad settings") } → call resolves with inner value; nothing written */
});
test("searchKey ignores case and spacing and includes the year", () => {
  assert.equal(searchKey("  SD  7208 ", 1971), searchKey("sd 7208", 1971));
  assert.notEqual(searchKey("sd 7208", 1971), searchKey("sd 7208", undefined));
  assert.equal(searchKey("SD 7208", undefined), "search:sd 7208|-");
});
test("search results are cached per query and year", async () => { /* searchByCatno("SD 7208", 1971) twice → 1 inner call; with 1972 → another */ });
```
Fill each commented body with the assertions it names.

- [ ] **Step 2: Run, expect FAIL** (no migration 4 / module missing).
- [ ] **Step 3: Implement** to the spec's `lib/discogs-cache.ts` behaviour, plus: a hit requires `0 <= now - fetched_at < ttl`; a throwing `cacheHours()` is caught, logged, and treated as 0. One private `cached<T>(key, fresh, load: () => Promise<T>)` does all three methods. Upsert with `INSERT ... ON CONFLICT(key) DO UPDATE`.
- [ ] **Step 4: Run `npm test`**, expect green. The migration-3 test in `tests/db.test.ts` may assert `migrate(db, migrations) === 3`; if so pin it to `migrations.slice(0, 3)` as was done for migration 2.
- [ ] **Step 5: Commit** `feat(discogs): SQLite response cache around the shared client`

---

### Task 3: Single-record lookup uses the cache

**Files:**
- Create: `tests/helpers/live-client.ts`
- Modify: `lib/lookup.ts`, `app/api/lookup/route.ts`
- Test: `tests/lookup.test.ts`, `tests/lookup-route.test.ts`

**Interfaces:**
- Consumes: `CachedLookupClient`, `Fetched` (Task 2), `getLookupClient`.
- Produces:
  - `tests/helpers/live-client.ts`: `export function live(inner: LookupClient, fetchedAt: () => number = () => 0, seen?: { fresh: (boolean | undefined)[] }): CachedLookupClient` — calls `inner`, wraps results as `{ value, fetchedAt: fetchedAt() }`, and pushes each `opts?.fresh` into `seen.fresh`.
  - `LookupRequest.fresh?: boolean`.
  - `runLookup(client: CachedLookupClient, req: LookupRequest, settings: Settings, now: () => number = Date.now)`.
  - `priced` / `no-price` responses gain `fetchedAt: number; cached: boolean`.

- [ ] **Step 1: Write the failing tests** (switch `fakeClient` in `tests/lookup.test.ts` to return `live(inner, ...)`; existing assertions on `calls` keep working)

```ts
test("runLookup reports cached prices and their age", async () => {
  const { client } = fakeClient({ candidates: [mk(1)] }, () => 1000);   // all fetchedAt = 1000
  const res = await runLookup(client, req, settings, () => 5000);
  assert.equal(res.status, "priced");
  assert.equal(res.status === "priced" && res.cached, true);
  assert.equal(res.status === "priced" && res.fetchedAt, 1000);
});
test("fresh data is not reported as cached", async () => {
  const { client } = fakeClient({ candidates: [mk(1)] }, () => 5000);
  const res = await runLookup(client, req, settings, () => 5000);
  assert.equal(res.status === "priced" && res.cached, false);
});
test("fresh reaches suggestions and stats but not search", async () => {
  const seen = { fresh: [] as (boolean | undefined)[] };
  const { client } = fakeClient({}, () => 0, seen);
  await runLookup(client, { ...req, releaseId: 9, fresh: true }, settings);
  assert.deepEqual(seen.fresh, [true, true]);
});
test("fetchedAt is the older of suggestions and stats", async () => { /* helper variant with per-method fetchedAt: sugg 2000, stats 1000 → 1000 */ });
test("parseLookupRequest accepts fresh only with a release id", () => {
  const base = { catno: "X", record: "NM", sleeve: "NM" };
  assert.equal(parseLookupRequest({ ...base, releaseId: 5, fresh: true }).ok, true);
  assert.equal(parseLookupRequest({ ...base, fresh: true }).ok, false);
  assert.equal(parseLookupRequest({ ...base, releaseId: 5, fresh: "yes" }).ok, false);
});
```
`fakeClient(opts, fetchedAt?, seen?)` gains the two optional params and passes them to `live`.

- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.** `cached = fetchedAt < startedAt` where `startedAt = now()` taken at the top of `runLookup`. The route passes `getLookupClient()`.
- [ ] **Step 4: Run `npm test` and `npm run typecheck`**, expect green.
- [ ] **Step 5: Commit** `feat(lookup): single-record lookups use the cache; fresh re-pricing`

---

### Task 4: Lots — refresh flag, worker, oldest-price age

**Files:**
- Modify: `lib/collection/types.ts` (`ItemRow.refresh: boolean`), `lib/collection/store.ts` (`toItem`, `repriceSession`, `retryItem`, `applyLookup`), `lib/collection/worker.ts`, `lib/collection/view.ts` (`oldestPricedAt`), `app/api/sessions/[id]/route.ts` (GET adds `oldestPricedAt`), `app/collection/[id]/api.ts` (`LotData.oldestPricedAt: number | null`)
- Test: `tests/collection-store.test.ts`, `tests/collection-worker.test.ts`, `tests/collection-view.test.ts`, `tests/collection-routes.test.ts`

**Interfaces:**
- Consumes: `CachedLookupClient`, `getLookupClient` (Task 2); `live` helper (Task 3).
- Produces: `processItem(client: CachedLookupClient, item: ItemRow, now: number)`; `WorkerDeps.client?: CachedLookupClient`; `oldestPricedAt(items: ItemRow[]): number | null`; lot GET body field `oldestPricedAt`.

- [ ] **Step 1: Write the failing tests** (switch `fake()` in `tests/collection-worker.test.ts` to wrap with `live`)

```ts
// collection-store
test("reprice and retry set refresh; applyLookup clears it", () => {
  /* priced row → repriceSession → getItem(...).refresh === true; claimNextPending + applyLookup → refresh === false;
     error row → retryItem → refresh === true */
});
// collection-worker
test("processItem passes fresh from the row and prices at the data's age", async () => {
  const seen = { fresh: [] as (boolean | undefined)[] };
  const client = live(fake().client, () => 400, seen);
  const patch = await processItem(client, { ...item, releaseId: 1, refresh: true }, 900);
  assert.deepEqual(seen.fresh, [true, true]);
  assert.equal(patch.pricedAt, 400);
});
test("retrying a no-match searches fresh", async () => { /* item with releaseId null, refresh true → seen.fresh[0] === true */ });
// collection-view
test("oldestPricedAt is the smallest pricedAt among priced rows", () => {
  /* rows: priced@300, priced@100, no-price@50, pending null → 100; no priced rows → null */
});
// collection-routes
test("lot GET includes oldestPricedAt", async () => { /* after the worker prices one row, body.oldestPricedAt is a number */ });
```

- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.** `applyLookup` always adds `refresh = 0` to its SET list. `pricedAt` = `Math.min(suggestions.fetchedAt, stats.fetchedAt)`. Worker default client: `getLookupClient()`. Keep the existing worker tests' `now` assertions meaningful: where they assert `pricedAt === now()`, give `live` the same clock.
- [ ] **Step 4: Run `npm test` and `npm run typecheck`**, expect green.
- [ ] **Step 5: Commit** `feat(collection): lots use the cache; re-price and retry fetch fresh`

---

### Task 5: Age lines and Refresh in the UI

**Files:**
- Create: `lib/relative-time.ts` (move `relativeTime` from `app/collection/LotsList.tsx` unchanged; LotsList imports it)
- Modify: `app/Lookup.tsx` (age line + Refresh), `app/collection/[id]/LotHeader.tsx` (oldest line; new prop `oldestPricedAt: number | null`), `app/collection/[id]/LotView.tsx` (pass it), `app/globals.css` (only if the age line needs a class)
- Test: `tests/relative-time.test.ts`

**Interfaces:**
- Consumes: `cached` / `fetchedAt` on lookup responses (Task 3); `LotData.oldestPricedAt` (Task 4).
- Produces: `relativeTime(t: number, now?: number): string`.

- [ ] **Step 1: Write the failing test** for the moved helper

```ts
test("relativeTime", () => {
  const now = Date.UTC(2026, 9, 4, 12);
  assert.equal(relativeTime(now - 30_000, now), "just now");
  assert.equal(relativeTime(now - 5 * 60_000, now), "5 minutes ago");
  assert.equal(relativeTime(now - 3 * 3_600_000, now), "3 hours ago");
  assert.equal(relativeTime(now - 86_400_000, now), "yesterday");
});
```

- [ ] **Step 2: Run, expect FAIL** (module missing). **Step 3: Move the helper**; run, expect PASS.
- [ ] **Step 4: Build the UI.**
  - `ResultCard` gets `onRefresh?: () => void`. When `res.cached` (priced or no-price), render below the title block: `Prices from {relativeTime(res.fetchedAt)} · ` + a `button.link` "Refresh prices" calling `onRefresh`.
  - In `Lookup`, `price()` gains `opts.fresh?: boolean` sent as `fresh: true` in the body; `onRefresh` calls `price(releaseId, release, { fresh: true, focus: false })` through the same in-place path as `reprice` (dimmed, `aria-busy`).
  - `LotHeader`: when `oldestPricedAt !== null && Date.now() - oldestPricedAt > 3_600_000`, show `<p className="meta muted small">Oldest prices: {relativeTime(oldestPricedAt)}</p>` next to the Re-price button.
- [ ] **Step 5: Run `npm run typecheck`, `npm test`, `npm run build`**, expect green.
- [ ] **Step 6: Commit** `feat(ui): cached-price age and Refresh; oldest-price line on lots`

---

### Task 6: Settings leave-guard for in-app links

**Files:**
- Modify: `app/settings/SettingsForm.tsx`

- [ ] **Step 1: Implement** in the existing `dirty` effect: also add a capture-phase `click` listener on `document` that, for a left click with no modifier keys on an `<a>` (via `closest("a")`) with no `target` attribute and same-origin `href`, calls the spec's `confirm(...)` and `preventDefault()` + `stopPropagation()` on cancel. Remove it in the effect cleanup.
- [ ] **Step 2: Run `npm run typecheck` and `npm run build`**, expect green. (No DOM test harness; checked by hand on staging.)
- [ ] **Step 3: Commit** `feat(settings): warn before leaving through a nav link with unsaved edits`

---

### Task 7: Docs, staging, PR

**Files:** `CLAUDE.md`, `README.md`

- [ ] **Step 1: Edit docs.**
  - `CLAUDE.md` Decisions: one bullet — Discogs answers are cached in SQLite (`lib/discogs-cache.ts`, `getLookupClient()`) for `discogs.cacheHours`; Re-price, Retry and Refresh bypass it; errors are never cached. Layout: add `lib/discogs-cache.ts`, `lib/relative-time.ts`. Status: "Phase 6b Discogs cache (2026-10-04): built on feat/discogs-cache; <N> tests passing; migration 4 (`discogs_cache`, `items.refresh`); staging check pending." Later phases: remove 6b.
  - `README.md`: Settings section mentions cache hours (0 = off); "How prices are worked out" says Discogs answers are reused for up to that many hours, with Refresh / Re-price to fetch fresh; Roadmap drops "Price cache".
- [ ] **Step 2: Run `npm test && npm run typecheck`**, expect green; commit `docs: Discogs cache in CLAUDE.md and README`.
- [ ] **Step 3: Ask the user before pushing**, then push the branch and fast-forward `staging` (check `git merge-base --is-ancestor origin/staging HEAD`).
- [ ] **Step 4: Staging check:** deploy workflow passes; health 200; the user checks a repeat lookup is instant with the age line, Refresh, lot Re-price, and the settings leave-guard.
- [ ] **Step 5: PR to `main`** (title "Phase 6b: Discogs response cache"), merge on the user's go-ahead, watch the prod deploy.

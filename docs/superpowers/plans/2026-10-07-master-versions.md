# Master Versions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A "Vinyl versions" panel on the single-record result card that lists a master's vinyl versions, marks this copy and the earliest listed year, says whether this copy is a reissue, and re-prices another version when picked.

**Architecture:** A new `DiscogsClient.masterVersions` (cached as `versions:<masterId>`) behind `GET /api/masters/:id/versions`; pure sorting/flag/filter logic in `lib/versions.ts`; a client `VersionsPanel` (button + list) rendered in `ResultCard` and keyed by release id; picking calls Lookup's existing `price()`.

**Tech Stack:** Next.js App Router, TypeScript, Node's built-in test runner (`node --test`), SQLite (`node:sqlite`) cache.

**Spec:** `docs/superpowers/specs/2026-10-07-master-versions-design.md`

## Global Constraints

- Branch `feat/master-versions`. No migration, no new setting, no new dependency.
- Discogs calls only server-side, through the shared throttled client (`getLookupClient()`); `DISCOGS_TOKEN` never reaches the browser.
- Versions request params: `format=Vinyl`, `sort=released`, `sort_order=asc`, `per_page=100`, `page=n`; at most 3 pages.
- Copy: "Vinyl versions" (button), "Earliest listed" (chip), "This copy" (chip), "earliest listed on Discogs" — never "original".
- Discogs terms: credit `DiscogsCredit` with `masterUrl(id)` = `https://www.discogs.com/master/<id>`, no `nofollow`; nothing shown past `MAX_CACHE_HOURS` (6) — use `dataExpired(fetchedAt, now)`.
- `lib/` uses relative imports with `.ts` extensions; UI files import `@/...`. Colours only from CSS tokens in `app/globals.css`; any `font-variant-numeric: tabular-nums` rule also sets `font-family: var(--font-numeric)`. Only Kanit weights 400/500/600/700.
- Keep `npm test` and `npm run typecheck` green after every task. Don't run `npm run build` while a `next dev` is running (check first).

## Review Focus

1. **Switching releases while the panel is open:** after picking a version the new card must show a fresh, closed panel for the new release (not the old list, not a request for the old master). Pinned by keying the panel on `res.releaseId` (Task 4).
2. **Grade change while the panel is open:** re-pricing the same release keeps the panel open with its list, no refetch. Same key (Task 4).
3. **This copy missing from the fetched 300:** the flag uses the card's `release.year`. Pinned by `thisCopyYear` tests (Task 1).
4. **Odd `released` values** (`"1972-05-12"`, `"0"`, `""`, `"Unknown"`, missing): year parses or is `null`, never `NaN`. Pinned in `toVersion` tests (Task 2).
5. **Clicking a version while the card is re-pricing:** rows are disabled while `busy` (Task 4).

---

### Task 1: Pure version logic and the master link

**Files:**
- Create: `lib/versions.ts`, `tests/versions.test.ts`
- Modify: `lib/discogs-terms.ts` (add `masterUrl`), `tests/discogs-terms.test.ts`

**Interfaces:**
- Produces (all in `lib/versions.ts`, operating on `Candidate` from `lib/types.ts`):
  - `sortVersions(vs: Candidate[]): Candidate[]` — new array, year ascending, `null` years last, stable.
  - `earliestYear(vs: Candidate[]): number | null`
  - `type VersionFlag = "earliest" | "reissue"`
  - `versionFlag(thisYear: number | null, earliest: number | null): VersionFlag | null`
  - `thisCopyYear(vs: Candidate[], releaseId: number, fallback: number | null): number | null` — the year of the version with `id === releaseId`, else `fallback`. (A version found with `year: null` also falls back.)
  - `filterVersions(vs: Candidate[], text: string): Candidate[]` — trimmed, case-insensitive substring over `label`, `catno`, `country`, `format`, `String(year)`; empty text returns `vs`.
- Produces in `lib/discogs-terms.ts`: `masterUrl(id: number): string`.

- [ ] **Step 1: Write failing tests** in `tests/versions.test.ts` (use a `v(id, year, extra?)` helper building a `Candidate`):
  - `sortVersions([v(1,1972), v(2,null), v(3,1958), v(4,1958)])` ids → `[3,4,1,2]`; input array unchanged.
  - `earliestYear` → `1958` for that list; `null` for `[v(1,null)]` and `[]`.
  - `versionFlag(1958,1958)` → `"earliest"`; `(1972,1958)` → `"reissue"`; `(1950,1958)` → `"earliest"`; `(null,1958)`, `(1972,null)` → `null`.
  - `thisCopyYear(list, 1, 2000)` → `1972`; `(list, 99, 1965)` → `1965`; `(list, 2, 1965)` → `1965` (found but no year); `(list, 99, null)` → `null`.
  - `filterVersions`: `"blue note"` matches label "Blue Note"; `"1577"` matches catno "BLP 1577"; `"jp"` matches country "JP" only; `"mono"` matches format; `"1958"` matches year; `"  "` returns all.
  - In `tests/discogs-terms.test.ts`: `masterUrl(32208)` === `"https://www.discogs.com/master/32208"`.
- [ ] **Step 2: Run** `node --experimental-strip-types --no-warnings --test tests/versions.test.ts tests/discogs-terms.test.ts` — expect FAIL (module/export missing).
- [ ] **Step 3: Implement** `lib/versions.ts` (header comment like `lib/runout.ts`: pure, client-safe) and `masterUrl` next to `releaseUrl`.
- [ ] **Step 4: Run** the same command — expect PASS; then `npm test` and `npm run typecheck` green.
- [ ] **Step 5: Commit** `feat(versions): pure sort, earliest-year flag and filter for master versions`

### Task 2: Discogs client and cache

**Files:**
- Modify: `lib/discogs.ts`, `lib/discogs-cache.ts`, `lib/discogs-client.ts`
- Modify (the only fake passed to `new CachedClient`): `tests/discogs-cache.test.ts` `inner`
- Test: `tests/discogs.test.ts`, `tests/discogs-cache.test.ts`

**Interfaces:**
- Produces in `lib/discogs.ts`:
  - `type MasterVersions = { versions: Candidate[]; total: number }` (exported)
  - `toVersion(raw: VersionResult): Candidate` where `VersionResult = { id: number; title?: string; released?: string; country?: string; label?: string; catno?: string; format?: string; thumb?: string }`. Year = `Number(released.slice(0,4))` when that is an integer > 0, else `null`.
  - `DiscogsClient.masterVersions(masterId: number, maxPages = 3): Promise<MasterVersions>` — `GET /masters/{id}/versions` with the Global Constraints params; stops at `pagination.pages` or `maxPages`; `total = pagination.items ?? versions.length`; 404 on page 1 → `{ versions: [], total: 0 }`.
- Produces in `lib/discogs-cache.ts`:
  - `type VersionsClient = { masterVersions(masterId: number): Promise<MasterVersions> }`
  - `type CachedVersionsClient = { masterVersions(masterId: number, opts?: FetchOpts): Promise<Fetched<MasterVersions>> }`
  - `CachedClient` constructor takes `inner: LookupClient & VersionsClient` and implements `CachedLookupClient & CachedVersionsClient`; key `versions:<masterId>`.
  - `LookupClient` and `CachedLookupClient` are **unchanged** (so `runLookup`, the worker and the `live()` helper need no edits).
- Produces in `lib/discogs-client.ts`: `getLookupClient(): CachedLookupClient & CachedVersionsClient`.

- [ ] **Step 1: Write failing tests** in `tests/discogs.test.ts` (use `makeClient` and `json`):
  - `toVersion` with `released` `"1958"` → 1958; `"1972-05-12"` → 1972; `"0"`, `""`, `"Unknown"`, missing → `null`; `label: "Blue Note"`, `catno: "BLP 1577"`, `country: "US"`, `format: "LP, Album, Mono"`, `thumb: ""` → `thumb: null`, missing fields → `null`.
  - `masterVersions sends the vinyl filter and release-date sort`: first request path `/masters/32208/versions` with `format=Vinyl`, `sort=released`, `sort_order=asc`, `per_page=100`, `page=1`.
  - `masterVersions follows pages up to 3 and reports the total`: handler answers `pagination: { pages: 5, items: 412 }` with 100 versions per page → 3 calls, 300 versions, `total` 412.
  - `masterVersions stops at the last page`: `pages: 2` → 2 calls.
  - `masterVersions of a missing master is empty`: 404 → `{ versions: [], total: 0 }`.
  - In `tests/discogs-cache.test.ts` (add `masterVersions` to `inner`, pushing `versions:<id>` to `calls`): `master versions are cached under versions:<id>` — two calls → inner once, row key `versions:32208` exists; with `{ fresh: true }` → inner called again.
- [ ] **Step 2: Run** `node --experimental-strip-types --no-warnings --test tests/discogs.test.ts tests/discogs-cache.test.ts` — expect FAIL.
- [ ] **Step 3: Implement** the client method, `toVersion`, the cache method and types, and widen `getLookupClient`'s return type.
- [ ] **Step 4: Run** the same command — PASS; `npm test`, `npm run typecheck` green.
- [ ] **Step 5: Commit** `feat(discogs): master versions (vinyl, paged) through the cached client`

### Task 3: `GET /api/masters/:id/versions`

**Files:**
- Create: `app/api/masters/[id]/versions/route.ts`, `tests/versions-route.test.ts`

**Interfaces:**
- Consumes: `getLookupClient().masterVersions(id)` (Task 2).
- Produces: `GET` → 200 `{ versions: Candidate[]; total: number; fetchedAt: number }`, or `{ status: "error", kind, message }` with `httpStatus(res)`. Export `type VersionsResponse = { versions: Candidate[]; total: number; fetchedAt: number }` from `lib/versions.ts` (type only) for the panel.

- [ ] **Step 1: Write failing tests**, modelled on `tests/identifiers-route.test.ts` (same env/cookie/`__mintDb` setup; fake `g.__discogsClient = { async masterVersions() { calls++; return answer(); } }`):
  - `needs a session` → 401.
  - `a bad id is 400 and never reaches Discogs` for `"abc"`, `"-1"`, `"1.5"`; `calls === 0`.
  - `returns the master's versions, from the cache the second time`: 200, body `versions` and `total` equal the fake's, `typeof fetchedAt === "number"`; second request → `calls === 1`.
  - `a rate limit maps to the lookup route's status`: fake throws `new DiscogsError("x", 429)` → status `httpStatus({ status: "error", kind: "rate-limited", message: "" })`, body `kind === "rate-limited"`.
  - `missing env is reported`: `DISCOGS_TOKEN = ""` → body `kind === "missing-env"`.
- [ ] **Step 2: Run** `node --experimental-strip-types --no-warnings --test tests/versions-route.test.ts` — FAIL.
- [ ] **Step 3: Implement** the route as a copy of `app/api/releases/[id]/identifiers/route.ts` with the header comment updated, calling `masterVersions` and responding `{ versions: value.versions, total: value.total, fetchedAt }`. `tests/structure.test.ts` must stay green (route file under `app/api/`).
- [ ] **Step 4: Run** — PASS; `npm test`, `npm run typecheck` green.
- [ ] **Step 5: Commit** `feat(api): GET /api/masters/:id/versions`

### Task 4: Versions panel on the result card, plus docs

**Files:**
- Create: `components/lookup/VersionsPanel.tsx`
- Modify: `components/lookup/Lookup.tsx` (`ResultCard` props and render; pass `onPick`), `app/globals.css`, `tests/discogs-terms.test.ts`, `CLAUDE.md` (Layout `components/lookup/` + `lib/` lists, `app/api/` route list, a Phase 12 Status line), `docs/ROADMAP.md` (Phase 12 heading "(built)" + one-line summary, table row)

**Interfaces:**
- Consumes: `VersionsResponse`, `sortVersions`, `earliestYear`, `versionFlag`, `thisCopyYear`, `filterVersions` (Task 1); `masterUrl`, `dataExpired`, `MAX_CACHE_HOURS` from `@/lib/discogs-terms.ts`; `api` from `@/lib/collection/client.ts` (handles 401 → login); `Thumb` from `Picker.tsx`; `DiscogsCredit`.
- Produces: `export default function VersionsPanel(props: { masterId: number; releaseId: number; fallbackYear: number | null; busy: boolean; onPick: (c: Candidate) => void })`. It renders its own disclosure button and the list.

- [ ] **Step 1: Write the failing terms test** in `tests/discogs-terms.test.ts`: `VersionsPanel.tsx` source matches `/<DiscogsCredit href=\{masterUrl\(/` and doesn't match `/nofollow/`.
- [ ] **Step 2: Run** `node --experimental-strip-types --no-warnings --test tests/discogs-terms.test.ts` — FAIL (file missing).
- [ ] **Step 3: Build `VersionsPanel`** per the spec's UI section:
  - State: `open` (bool), `state: { status: "idle" } | { status: "loading" } | { status: "loaded"; data: VersionsResponse } | { status: "error"; message: string }`, `filter`, `now` (with a timeout to the 6-hour mark like `ResultCard`). Fetch on first open (and on Retry / Reload) with an `AbortController` aborted on unmount.
  - Button: `className="secondary"`, text "Vinyl versions", `aria-expanded`, `aria-controls="versions-panel"`.
  - Exact copy from the spec: "Loading versions…", "No vinyl versions listed on Discogs.", "This copy (1972) is a reissue. Earliest vinyl listed on Discogs: 1958.", "This copy is from the earliest year listed on Discogs (1958).", "Earliest vinyl listed on Discogs: 1958.", "199 vinyl versions" / "Showing the first 300 of 412 vinyl versions", placeholder "Filter by label, country, catno, year…" with `aria-label="Filter versions"`, "Nothing matches that filter.", "These versions are more than 6 hours old." + "Reload".
  - Rows: `ul.candidates`; this copy is a `div.candidate.version-current` with `aria-current="true"` and a "This copy" chip; others are `button.candidate` with `disabled={busy}` calling `onPick(v)`; versions whose year equals the earliest get an "Earliest listed" chip. Chips use a new `.version-chip` class.
- [ ] **Step 4: Wire into `ResultCard`**: add props `onPick` and render, under the credit paragraph and only when `!expired && res.stats.masterId`, `<VersionsPanel key={res.releaseId} masterId={res.stats.masterId} releaseId={res.releaseId} fallbackYear={release?.year ?? null} busy={busy} onPick={onPick} />`. In `Lookup`, pass `onPick={(c) => void price(c.id, c, { focus: true })}`.
- [ ] **Step 5: CSS** in `app/globals.css` near the picker rules: `.versions` panel spacing, `.version-chip` (like `.demand`, colours via `--accent`/`--accent-soft`), `.version-current` (non-interactive row, no hover), years in `.candidate-meta` already styled (if adding `tabular-nums`, add `font-family: var(--font-numeric)`). Animation only via existing tokens and inside the reduced-motion guard pattern the motion test expects.
- [ ] **Step 6: Docs**: CLAUDE.md layout/routes/status line ("Phase 12 master versions (2026-10-07): built on feat/master-versions; N tests passing; no migration. 'Vinyl versions' panel on the result card … Spec: …"); ROADMAP Phase 12 marked built.
- [ ] **Step 7: Run** `npm test` and `npm run typecheck` — all green (font, motion, theme-contrast, structure, docs tests included).
- [ ] **Step 8: Commit** `feat(lookup): Vinyl versions panel on the result card`

### Task 5: Check it in the running app

- [ ] **Step 1:** Make sure a dev server is running (`npm run dev`, or reuse one already on :3000).
- [ ] **Step 2:** Price catno `BLP 1577`, pick release 5193282 (1958). Open "Vinyl versions": the count reads about 199, 5193282 shows "This copy", the 1958 rows show "Earliest listed", the summary says earliest year.
- [ ] **Step 3:** Pick a 1970s version from the panel: the card re-prices that release, focus moves to its heading, the panel is closed; reopening shows "is a reissue. Earliest vinyl listed on Discogs: 1958." with no new Discogs call for the same master (cache).
- [ ] **Step 4:** With the panel open, change the record grade: the panel stays open with the same list.
- [ ] **Step 5:** Check at 375px width (no horizontal scroll, 44px controls) and in dark mode.
- [ ] **Step 6:** Record the observed call counts in the spec's Status line (`Status: built on feat/master-versions (live: …)`) and commit `docs: Phase 12 status`.

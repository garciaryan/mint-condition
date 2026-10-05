# Phase 6b: Discogs response cache

Date: 2026-10-04 · Status: approved design, awaiting spec review
Builds on: `docs/superpowers/specs/2026-10-04-settings-ui-design.md` (saved settings, `/settings` page)

## Why

Every lookup on the single-record page calls Discogs again: a grade or area-code change re-fetches suggestions and
stats, and a new search walks up to 3 pages per catno variant. Lots store their data per row, but the same record in
another lot is searched and priced from scratch. All calls share one throttle (~1.1 s apart), so a 100-record lot
takes minutes and a single-record lookup waits behind it.

Success:
- Repeat requests within `discogs.cacheHours` (default 24) are answered from SQLite with no Discogs call and no wait
  in the throttle; re-grading on the single-record page is instant after the first lookup.
- Re-price (lots), Retry (lots) and a new "Refresh prices" link (single-record page) always fetch fresh.
- When shown prices came from the cache, the screen says how old they are.
- Errors are never cached; a cache problem never breaks a lookup.

## Decisions (from brainstorming)

- **Bypass:** Re-price and Retry on lots, and "Refresh prices" on the single-record result, skip the cache and update
  it. Everything else (first lookups, grade/area changes, the worker's first pass, picking a pressing) uses it.
- **Age display:** only when data came from the cache. Single-record card: "Prices from 3 h ago · Refresh prices".
  Lots: one line next to Re-price, "Oldest prices: 2 d ago", when the oldest priced row is more than an hour old.
- **Approach:** a caching wrapper (`CachedClient`) around the shared `DiscogsClient`, backed by a SQLite table.
  `lib/discogs.ts` stays pure HTTP.
- **Ride-along:** the settings page warns before leaving through an in-app link with unsaved edits.

## Non-goals

- Serving stale cache data when Discogs errors (rate-limited, down). Errors surface as today.
- A "clear cache" button. Setting cache hours to 0 disables reads and writes.
- Per-row age lines in lots.
- De-duplicating concurrent identical misses (worker and page fetching the same release at once both fetch; last
  write wins).

## Data

Migration 4 (append to `lib/migrations.ts`):

```sql
CREATE TABLE discogs_cache (
  key        TEXT    PRIMARY KEY,   -- "search:<query>|<year or ->", "suggestions:<releaseId>", "stats:<releaseId>"
  json       TEXT    NOT NULL,      -- the method's result, including empty search and null suggestions
  fetched_at INTEGER NOT NULL       -- ms epoch, when Discogs answered
);
ALTER TABLE items ADD COLUMN refresh INTEGER NOT NULL DEFAULT 0;  -- 1 = the next lookup for this row skips the cache
```

## Settings

- `parseSettings` validates `discogs.cacheHours`: an integer from 0 to 168. Error
  `settings: discogs.cacheHours must be an integer from 0 to 168`.
- The settings page gains a **Discogs** section: "Cache prices for (hours)" (`discogs.cacheHours`, field limits
  0–168 whole number, default hint) and the read-only currency line moves into it.
- `saveSettings` still never stores `discogs.currency`; `discogs.cacheHours` is stored like any other field.

## Units

### `lib/discogs-cache.ts` (server-side)

```ts
export type Fetched<T> = { value: T; fetchedAt: number };
export type FetchOpts = { fresh?: boolean };
export type CachedLookupClient = {
  searchByCatno(query: string, year: number | undefined, opts?: FetchOpts): Promise<Fetched<Candidate[]>>;
  priceSuggestions(releaseId: number, opts?: FetchOpts): Promise<Fetched<PriceSuggestions | null>>;
  marketplaceStats(releaseId: number, opts?: FetchOpts): Promise<Fetched<MarketplaceStats>>;
};
export class CachedClient implements CachedLookupClient {
  constructor(inner: LookupClient, deps: { db: () => DatabaseSync; cacheHours: () => number; now?: () => number });
}
export function searchKey(query: string, year: number | undefined): string;
```

Behaviour per call:
- `ttl = cacheHours() * 3_600_000`. With `ttl === 0`, call `inner` and return `{ value, fetchedAt: now() }`; no read,
  no write.
- Unless `opts.fresh`, read the row for the key. A row with `now() - fetched_at < ttl` whose JSON parses is a hit:
  return `{ value: parsed, fetchedAt: fetched_at }`. An expired or unparseable row is a miss.
- On a miss or `fresh`: call `inner`. If it throws, rethrow (nothing is written; an existing row is left alone).
  Otherwise upsert `{ key, json, fetched_at: now() }`, delete rows with `fetched_at <= now() - ttl`, and return
  `{ value, fetchedAt: now() }`. A failing read or write is logged (`console.error`) and treated as a miss / ignored.
- Keys: `searchKey(query, year)` = `search:` + `query.trim().toLowerCase().replace(/\s+/g, " ")` + `|` + (year ?? `-`);
  `suggestions:<id>`; `stats:<id>`.

### `lib/discogs-client.ts`

Adds `getLookupClient(): CachedLookupClient`, one `CachedClient` per process on `globalThis`, built on
`getDiscogsClient()` with `db: getDb` and `cacheHours: () => getSettings(getDb()).settings.discogs.cacheHours`
(read per call so a settings save applies immediately). `getDiscogsClient()` is unchanged.

### `lib/lookup.ts`

- `LookupRequest` gains `fresh?: boolean`. `parseLookupRequest` accepts `fresh: true` only with `releaseId`;
  `fresh` without `releaseId`, or a non-boolean, is a 400 `bad-request`.
- `runLookup(client: CachedLookupClient, req, settings)`: search uses the cache (never `fresh`); suggestions and
  stats pass `{ fresh: req.fresh }`.
- `priced` and `no-price` responses gain `fetchedAt: number` (the older of the suggestions and stats `fetchedAt`)
  and `cached: boolean` (`fetchedAt` is earlier than the time `runLookup` started).
- `app/api/lookup/route.ts` passes `getLookupClient()`.

### Lots

- `repriceSession` and `retryItem` also set `refresh = 1`. `ItemRow` gains `refresh: boolean`.
- `processItem(client: CachedLookupClient, item, now)`: passes `{ fresh: item.refresh }` to search, suggestions and
  stats. The patch's `pricedAt` is the older of the suggestions and stats `fetchedAt` (not `now`).
- `applyLookup` clears `refresh` (sets 0) on every write.
- `worker.ts` uses `getLookupClient()` by default; `WorkerDeps.client` becomes `CachedLookupClient`.
- `oldestPricedAt(items: ItemRow[]): number | null` (pure, in `lib/collection/view.ts`): the smallest `pricedAt` among
  rows with status `priced`, or null.
- The lot GET response includes `oldestPricedAt`. The lot page shows "Oldest prices: <age>" next to Re-price when it
  is more than 1 hour before now, with the age formatted like the lots list (`relativeTime`, moved to a shared
  client-safe module).

### Single-record page (`app/Lookup.tsx`)

- When a `priced` or `no-price` result has `cached: true`, the card shows "Prices from <age> · Refresh prices"
  (`<age>` like "3 h ago" via the shared relative-time helper). Refresh sends the current request with the shown
  `releaseId` and `fresh: true`, re-pricing in place (old result dimmed, `aria-busy`), like a grade change.
- Fresh results show no age line.

### Settings page ride-along (`app/settings/SettingsForm.tsx`)

While the form is dirty, a capture-phase `click` listener on `document` intercepts same-origin `<a>` clicks
(no modifier keys, no `target`) and asks `confirm("You have unsaved changes. Leave without saving?")`; cancel
calls `preventDefault()`.

## Errors

| Case | Behaviour |
|---|---|
| Corrupt cache row | Treated as a miss; refetched and overwritten. |
| Cache read or write throws | Logged; the lookup proceeds with Discogs' answer. |
| Fresh fetch fails (401, 429, 5xx, network) | Same errors and Retry as today; the existing row is kept. |
| `cacheHours` lowered | Older rows count as expired immediately. |
| `cacheHours` = 0 | No reads or writes. |
| `fresh` without `releaseId` | 400 `bad-request`. |

## Testing

Node's built-in runner, no new deps.
- `CachedClient` (fake inner client counting calls, in-memory DB, injected clock): hit makes no inner call; miss
  fetches and stores; a row at exactly `ttl` is expired; `fresh` bypasses and overwrites; empty search and null
  suggestions are cached; inner errors are not cached and an existing row survives; `cacheHours = 0` reads and writes
  nothing; corrupt row refetched; expired rows deleted on write; `searchKey` ignores case and spacing and includes year.
- Settings: `cacheHours` validation (non-integer, -1, 169 rejected; 0 and 168 accepted); form field round-trip and
  limits; `formatDefault` shows "24".
- `runLookup` / `parseLookupRequest`: `fresh` reaches suggestions and stats only; `cached` and `fetchedAt` correct;
  `fresh` without `releaseId` rejected.
- Store and worker: reprice and retry set `refresh`; `processItem` passes `fresh` from the row; `pricedAt` is the
  older `fetchedAt`; `applyLookup` clears `refresh`.
- `oldestPricedAt`: ignores non-priced rows; null when none.
- Existing fake clients move to the `Fetched` shape through one test helper.

## Rollout

1. Branch `feat/discogs-cache`.
2. Push to `staging`: migration 4 applies; a repeat single-record lookup is instant and shows the age line; Refresh
   fetches fresh; Re-price on a lot refreshes.
3. PR to `main` (deploys prod).
4. Update `CLAUDE.md` (layout, Decisions: the cache and its bypasses, Status: phase 6b) and the README (Settings
   section: cache hours; how prices are worked out: cached up to N hours).

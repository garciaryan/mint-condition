# Phase 12: Versions of a master

Date: 2026-10-07 · Status: built on feat/master-versions (live: master 32208 → 199 vinyl versions in 2 calls, repeat is a cache hit; 3 pressings marked 1958; a 1970 copy flagged reissue)
Roadmap: `docs/ROADMAP.md` (Phase 12). Builds on Phase 10 (`docs/superpowers/specs/2026-10-07-demand-signal-design.md`),
which stores `masterId` from `/releases/{id}` in `MarketplaceStats`.

## Why

To tell an original from a reissue, and to see where this copy sits among every pressing of the album.

Success:
- A priced record with a master shows a "Vinyl versions" panel on the result card.
- The panel marks this copy and the earliest listed year, and says whether this copy is a reissue.
- Picking another version re-prices it in place.

## Decisions (from brainstorming)

- **Result card only.** Lot rows don't get the panel; switching a lot row's pressing stays with the Pick panel.
- **On demand.** Nothing is fetched until the panel is opened. Pricing stays at two calls per record.
- **Vinyl only.** The list and the "earliest" comparison use `format=Vinyl`. Comparing across formats would call the
  first vinyl pressing of an album first issued on CD a "reissue", which is wrong for this app. The panel says
  "vinyl versions".
- **Wording.** "Earliest listed on Discogs", never "original".
- A dedicated panel, not the shared `Picker`: the picker is built around a catno search (heading, credit, title
  grouping) and has no notion of "this copy" or "earliest".

## Live check (2026-10-07)

`GET /masters/32208/versions` (Blue Train, from release 5193282): 329 versions over 4 pages of 100, of which 199 are
vinyl, 93 CD, 17 cassette. Response keys `pagination`, `filters`, `filter_facets` (`format`, `label`, `country`,
`released`), `versions`. Each version has `id`, `title`, `label` (string), `country`, `catno`, `format` (string, e.g.
"LP, Album, Mono"), `major_formats`, `released` (year string here; can be a full date), `thumb`, `status` and
`stats.community.in_wantlist/in_collection`. `sort=released&sort_order=asc` works and is the order Discogs returns.

## Discogs client (`lib/discogs.ts`)

```ts
export function toVersion(raw: VersionResult): Candidate;
async masterVersions(masterId: number, maxPages = 3): Promise<{ versions: Candidate[]; total: number }>;
```

- `masterVersions` calls `GET /masters/{id}/versions` with `format=Vinyl`, `sort=released`, `sort_order=asc`,
  `per_page=100`, `page=n`, following pages until `pagination.pages` or `maxPages`.
- `total` is `pagination.items` (all vinyl versions, even past the pages fetched).
- A 404 gives `{ versions: [], total: 0 }`.
- `toVersion` maps to the existing `Candidate` shape: `year` is the first four digits of `released` when they form a
  year greater than 0, else `null` (`"0"`, `""`, missing); `label`, `catno`, `country`, `format` are strings or
  `null`; `thumb` empty → `null`. Because versions are `Candidate`s, picking one goes through the existing
  `price(id, candidate)` path.
- Want/have per version is not used (YAGNI).

## Cache (`lib/discogs-cache.ts`)

- `masterVersions(masterId)` is added to `LookupClient` and `CachedLookupClient`, cached as `versions:<masterId>` for
  `discogs.cacheHours` like the other answers. `fresh` bypasses it; errors are never cached.

## API: `GET /api/masters/:id/versions`

- New file `app/api/masters/[id]/versions/route.ts`, built like `app/api/releases/[id]/identifiers/route.ts`:
  `requireSession`; `parseId` (bad id → 400 `bad-request`); missing env → `missing-env`; unopenable database →
  `database`; unreadable settings → `settings`.
- Calls `getLookupClient().masterVersions(id)` and responds `{ versions: Candidate[], total: number, fetchedAt: number }`.
- Thrown errors go through `toErrorResponse` and `httpStatus` from `lib/lookup.ts`.

## Pure logic: `lib/versions.ts` (client-safe)

```ts
export function sortVersions(vs: Candidate[]): Candidate[];          // year ascending, unknown last, stable
export function earliestYear(vs: Candidate[]): number | null;         // smallest known year
export type VersionFlag = "earliest" | "reissue";
export function versionFlag(thisYear: number | null, earliest: number | null): VersionFlag | null;
export function filterVersions(vs: Candidate[], text: string): Candidate[];
```

- `versionFlag`: equal years → `"earliest"`; `thisYear` later → `"reissue"`; either `null` → `null`. (An earlier
  `thisYear` can't happen when this copy is in the list; it returns `"earliest"`.)
- `filterVersions` matches label, catno, country, format and year, case-insensitive; empty text returns all.
- "This copy" is found in the list by `releaseId`, so its year comes from Discogs even when the card has no
  `release` details. If it isn't in the fetched pages, its year falls back to the card's `release.year`.
- **Truncation:** Discogs sorts by release date ascending, so the first 300 hold the earliest years and the flag stays
  correct for masters with more than 300 vinyl versions.

## UI

### Result card (`components/lookup/Lookup.tsx`)

- When `res.stats.masterId` is set and the figures aren't expired, a secondary **"Vinyl versions"** button sits under
  the "Data provided by Discogs" line. It's a disclosure (`aria-expanded`, `aria-controls`). The panel stays mounted
  while closed, so reopening doesn't refetch while the card is showing.
- No master → no button.

### `components/lookup/VersionsPanel.tsx` (new)

Props: `masterId`, `releaseId`, `fallbackYear` (the card's `release?.year`), `onPick(c: Candidate)`.

- **Loading:** "Loading versions…" with a spinner. An `AbortController` cancels the request on unmount.
- **Error:** the message and a "Retry" button. An `auth` error sends the browser to login, like lookups.
- **Empty:** "No vinyl versions listed on Discogs."
- **Summary** (`role="status"`):
  - reissue: "This copy (1972) is a reissue. Earliest vinyl listed on Discogs: 1958."
  - earliest: "This copy is from the earliest year listed on Discogs (1958)."
  - unknown: "Earliest vinyl listed on Discogs: 1958."
- **Header:** "199 vinyl versions", or "Showing the first 300 of 412 vinyl versions"; a filter box
  "Filter by label, country, catno, year…" (`aria-label="Filter versions"`). "Nothing matches that filter." when empty.
- **Rows** (sorted by `sortVersions`, styled like the picker's `.candidate` rows): thumb; label · catno — format;
  country and year.
  - The current release is marked **"This copy"**, has `aria-current="true"`, and isn't a button.
  - Versions from the earliest year get an **"Earliest listed"** chip (several can share it).
- **Credit:** `DiscogsCredit` linking to `masterUrl(masterId)` = `https://www.discogs.com/master/<id>` (new in
  `lib/discogs-terms.ts`).
- **6 hours:** the panel keeps the response's `fetchedAt`; once `dataExpired` it hides the list behind
  "These versions are more than 6 hours old." and a "Reload" button. The panel is also not shown while the card's
  figures are expired.

### Pagination (added 2026-10-07, review of PR #35)

- The whole list is still fetched once; it's shown 20 to a page (`VERSIONS_PAGE_SIZE`), so paging costs no calls and
  the earliest mark and the filter cover every version fetched.
- `paginate(items, page, size)` → `{ items, page, pages }` (1-based, clamped; an empty list is one empty page) and
  `pageOf(index, size)` (−1 → page 1) in `lib/versions.ts`, tested.
- The list opens on the page holding this copy (page 1 when it isn't listed). Typing in the filter goes back to page 1.
- Under the list, when there's more than one page: "← Previous · Page N of M · Next →" (`role="status"` on the page
  line, buttons disabled at the ends, 44px). Changing page scrolls the list to its top and focuses it.
- The page is kept while the panel is closed and reopened, and through grade changes (same release).

### Switching

- Clicking a row calls Lookup's `price(v.id, v, { focus: true })`: the new release's card replaces the old one
  (the panel goes with it) and focus moves to the new heading. "← Other pressings" still goes back to the original
  search results when there were some.

### Styles

- Colours only from tokens; chips styled like `DemandBadge`; years with `tabular-nums` also set
  `font-family: var(--font-numeric)`. Controls 44px tall on phones. The panel animates in only, and not at all under
  `prefers-reduced-motion`.

## Call count

| Action | Discogs calls |
|---|---|
| Open the panel | 1–3, one per 100 vinyl versions (0 if cached within `cacheHours`) |
| Switch to a version and price it | 2 (unchanged) |

## Tests

- **`lib/versions.ts`:** `sortVersions` (ascending, unknown last, stable); `earliestYear` (mixed, all unknown → null,
  empty → null); `versionFlag` (equal, later, null either side); `filterVersions` (each field, case, empty text).
- **`lib/discogs.ts`:** `toVersion` for `"1958"`, `"1972-05-12"`, `"0"`, missing `released`, and field mapping;
  `masterVersions` with a fake fetch sends `format=Vinyl`, `sort=released`, `sort_order=asc`, stops at
  `pagination.pages` and at 3 pages, takes `total` from `pagination.items`, and a 404 gives an empty list.
- **Cache:** a repeat call is a hit (inner client called once); `fresh` bypasses it.
- **Route:** 401 without a session; 400 for a bad id; versions from the fake client; a `DiscogsError` 429 maps to
  `rate-limited` with the lookup route's status.
- **Terms:** `masterUrl(32208)`; `VersionsPanel.tsx` renders `DiscogsCredit` with `masterUrl` and has no `nofollow`.
- Existing structure, font, motion and theme tests cover the new files and CSS.

## Done when

A priced Blue Train shows its vinyl versions, marks this copy and the 1958 pressings, labels a 1972 copy a reissue,
and switching to another version re-prices it.

No migration, no new setting.

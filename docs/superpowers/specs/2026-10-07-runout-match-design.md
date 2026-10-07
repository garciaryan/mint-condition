# Phase 11: Matching by runout in the picker

Date: 2026-10-07 · Status: built on feat/runout-match (live: 5193282 → 5 identifiers; repeat is a cache hit; pricing it then costs 1 call)
Roadmap: `docs/ROADMAP.md` (Phase 11). Builds on Phase 10 (`docs/superpowers/specs/2026-10-07-demand-signal-design.md`),
which stores identifiers from `/releases/{id}` and caches them as `release:<id>`.

## Why

A catalog number and year often match 20 or more pressings, and a first press can be worth ten times a repress. At
the table you identify a pressing by its dead wax (matrix/runout, mastering stamps, plant marks), not by the jacket.
The picker should let the owner type a fragment of what's scratched in the run-out groove and see which pressing it
is.

Success:
- With a catalog number that has 20+ pressings, the owner can narrow the list to one by checking runouts and typing a
  matrix fragment.
- It works the same in the single-record lookup and in a collection's Pick panel.
- The Discogs call count for the flow is known and written down (below).

## Decisions (from brainstorming)

- **Fetching:** the browser asks for one pressing's identifiers at a time through a new API route, using the shared
  cached client. It never fetches in bulk on its own.
- **Bulk check:** a "Check runouts" button fetches the pressings currently showing, but only when 25 or fewer are
  showing (decided 2026-10-07). It shows progress.
- **Matching:** every identifier type is searched (matrix/runout, pressing plant, mastering SID, label code, …). Case
  is ignored, and so is everything that isn't a letter or digit. "1577a" finds "BN 1577-A"; "rvg" finds
  "RVG BN-LP-1577-A... 9 M".

## API: `GET /api/releases/:id/identifiers`

- New file `app/api/releases/[id]/identifiers/route.ts`. It needs a session (`requireSession`).
- `parseId` validates the id; a bad id is 400 `bad-request`.
- It runs the same checks as `/api/lookup`, in order:
  - missing env gives `missing-env`;
  - an unopenable database gives `database`;
  - unreadable settings give `settings`.
- It calls `getLookupClient().releaseStats(id)`, cached as `release:<id>` for up to `discogs.cacheHours`.
- It responds `{ identifiers: Identifier[], fetchedAt: number }`.
- A release Discogs doesn't have (404) gives `identifiers: []`, as `parseReleaseStats` already does.
- A thrown error goes through `toErrorResponse` and `httpStatus` from `lib/lookup.ts` (`bad-token`, `rate-limited`,
  `upstream`), returned as `{ status: "error", kind, message }` with the same status codes as the lookup route.

## Matching: `lib/runout.ts` (pure, client-safe)

```ts
export function normalizeRunout(s: string): string;  // uppercase, letters and digits only
export type RunoutHit = { identifier: Identifier; ranges: [start: number, end: number][] };  // ranges in identifier.value
export function matchIdentifiers(identifiers: Identifier[], query: string): RunoutHit[];
```

- `normalizeRunout` uppercases the string and removes every character that isn't `A–Z`, `a–z` or `0–9`.
- `matchIdentifiers` normalizes the query.
  - An empty normalized query returns every identifier, with no ranges.
  - Otherwise it returns the identifiers whose normalized `value` contains the normalized query.
  - Each hit carries the ranges in the original `value` that cover the matched characters: from the first matched
    character's index to one past the last. Every occurrence is included.
  - It works by building, for each value, the list of original indexes of its letters and digits.
- Identifier `type` and `description` are shown but not searched.

## Picker UI (`components/lookup/Picker.tsx`; used by the lookup and by `PickPanel`)

- **State:** `runouts: Map<id, { status: "loading" } | { status: "loaded"; identifiers } | { status: "error"; message }>`.
  It lives only while the picker is mounted. An `AbortController` cancels in-flight requests on unmount.
- **Per pressing:** a "Runouts" toggle button beside the pick button, never nested inside it. Its accessible name is
  "Runouts for <title>", with `aria-expanded` and `aria-controls`.
  - Opening it fetches the identifiers if they aren't loaded yet.
  - The panel under the row lists each identifier as `type: value (description)`.
  - While loading it shows "Loading runouts…". A pressing with no identifiers shows "No runouts on Discogs".
  - On error it shows the message and a "Retry" button.
- **Header controls,** under the existing "Filter by country, label, format…" box:
  - A "Runout contains…" search box (`aria-label="Runout contains"`).
  - A "Check runouts (N)" button, where N is the number of pressings showing after the text filter that aren't
    checked yet.
    - It fetches them one at a time, in the order shown, with a status line "Checked 7 of 18". The line is
      `role="status"`.
    - When more than 25 pressings are showing it's disabled, with the note
      "Narrow to 25 or fewer pressings first (filter or year)."
    - With nothing left to check it reads "All runouts checked" and is disabled.
- **While "Runout contains…" has text:**
  - The groups show only pressings whose runouts are loaded and match. Each one's panel opens automatically, showing
    only its matching identifiers with the matched characters in `<mark>`.
  - A line under the controls says "N pressings not checked yet", with the same Check button, when any showing
    pressings aren't loaded.
  - "No checked pressing matches that runout." appears when nothing matches.
- **Pure helpers in `lib/runout.ts`,** so the counts are tested:
  - `RUNOUT_CHECK_CAP = 25`
  - `checkPlan(visibleIds: number[], loaded: Set<number>): { toCheck: number[]; overCap: boolean }`. `overCap` is
    `visibleIds.length > RUNOUT_CHECK_CAP`, and `toCheck` lists the visible ids that aren't loaded, in order.
- **Picking** works as before. Pricing then reads the release from the cache, so a checked pressing costs only the
  price-suggestions call.
- **Discogs terms:** identifiers appear inside the picker, which already carries `DiscogsCredit` (the search link).
  They live only in memory while the picker is open, and the server cache keeps them within 6 hours.
- **Styles:** colours only from tokens, with `<mark>` styled using `--accent-soft` / `--ink`. Controls are 44px
  tall on phones.

## Call count

| Action | Discogs calls |
|---|---|
| Open one pressing's runouts | 1 (0 if cached in the last `cacheHours`) |
| "Check runouts" | 1 per unchecked pressing showing, at most 25 (about 28 s at the shared 1.1 s throttle) |
| Pick a checked pressing and price it | 1 (price suggestions; the release comes from the cache) |
| Pick an unchecked pressing and price it | 2 (unchanged) |

## Tests

- **`lib/runout.ts`:**
  - `normalizeRunout("RVG BN-LP-1577-A... 9 M")` → `"RVGBNLP1577A9M"`.
  - The Blue Train fixture: "1577a" matches the two "…1577-A" identifiers and not "-B"; "rvg" matches the two
    runout-side values; "bmi" matches Rights Society.
  - Ranges: in "BN 1577-A", "1577a" highlights `[3, 9]`.
  - An empty or punctuation-only query returns everything with no ranges.
  - `checkPlan`: under the cap, at the cap (25), over the cap (26), and skipping loaded ids.
- **Route:**
  - 401 without a session; 400 for a bad id.
  - Identifiers come from the fake client.
  - A second request is a cache hit: the inner client is called once.
  - A missing release gives `[]`.
  - A `DiscogsError` 429 maps to `rate-limited` with the lookup route's status code.
- **Terms:** the picker still renders `DiscogsCredit` (existing test), and it is the only component that renders
  identifiers.

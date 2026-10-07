# Phase 10: Release details and demand signal

Date: 2026-10-07 · Status: built on feat/demand-signal (live check: Blue Train → 3,357 want / 878 have, fast)
Roadmap: `docs/ROADMAP.md` (Phase 10). Builds on the collection, offer and Discogs cache specs.

## Why

A $30 suggestion with 1,800 copies for sale and few wants can sit unsold for a year, while a record with
want/have above 1 and four copies for sale moves in a week. How fast a record sells decides what to cherry-pick.
The owner wants to see that at a glance, and optionally keep slow sellers out of automatic picks.

Success:
- Every priced record shows want/have, and a fast or slow badge when one applies, on the single-record card and on
  lot rows.
- Pricing still takes two Discogs calls per record.
- A collection can leave slow sellers out of its automatic picks.

## Live check (2026-10-07, Blue Train, release 5193282)

| | `/marketplace/stats/{id}` (today) | `/releases/{id}` |
|---|---|---|
| For sale / lowest | `num_for_sale: 6`, `lowest_price: {value: 475, currency: "USD"}` | `num_for_sale: 6`, `lowest_price: 475` (bare number) |
| `curr_abbr=EUR` | `{value: 422.75, currency: "EUR"}` | `475` (ignored) |
| Want / have | none | `community: {want: 3357, have: 878}` |
| Other | | `master_id: 32208`, `identifiers: [{type: "Matrix / Runout", value: "BN 1577-A", description: "Label side A"}, …]` |

The app calls stats without `curr_abbr` today, so it already gets the Discogs account's currency. Lots already label
prices with `settings.discogs.currency`, and only the single-record card used stats' currency.

## Decisions (from brainstorming)

- **Approach:** `/releases/{id}` replaces `/marketplace/stats/{id}`, so pricing still takes two calls (price
  suggestions + release). Runouts and the master ID come along for Phases 11 and 12.
- **Currency:** the single-record card labels prices with `settings.discogs.currency`, as lots do.
- **Thresholds** (defaults, editable on `/settings`):
  - fast: want/have ≥ 1 and ≤ 10 for sale
  - slow: want/have < 0.3, or ≥ 200 for sale
- **The pick setting** is per collection and off by default.

## Data

- `lib/types.ts`:
  - `MarketplaceStats` gains optional fields: `have?: number`, `want?: number`, `masterId?: number | null` and
    `identifiers?: Identifier[]`, where `Identifier = { type: string; value: string; description?: string }`.
  - `currency` stays on the type and is `null` from the release endpoint.
  - The new fields are optional because rows stored before this phase lack them.
- `lib/discogs.ts`: `marketplaceStats(id)` is replaced by `releaseStats(id): Promise<MarketplaceStats>`, which calls
  `/releases/{id}`.
  - A pure `parseReleaseStats(body)` maps `lowest_price` (a number, or null) → `lowestPrice`, `num_for_sale` →
    `numForSale` (default 0), `community.have` / `community.want` → `have` / `want`, `master_id` → `masterId`
    (`null` when 0 or missing), and `identifiers` → `identifiers` (default `[]`, keeping only entries whose `type`
    and `value` are strings).
  - A 404 gives `{ lowestPrice: null, currency: null, numForSale: 0 }`, as stats did.
- `LookupClient`, `lib/discogs-cache.ts` (cache key `release:<id>`), `lib/lookup.ts` and `lib/collection/worker.ts`
  switch to `releaseStats`. The old `stats:<id>` cache rows are never read again and drop out within 6 hours.
- Lot rows keep the extra fields inside the existing `stats_json`. They share `priced_at`, so `hideExpired` and
  `requeueExpired` already cover them. No items migration is needed.
- **Migration 6:** `ALTER TABLE sessions ADD COLUMN skip_slow INTEGER NOT NULL DEFAULT 0;` with
  `SessionRow.skipSlow: boolean` and `SessionPatch.skipSlow?: boolean`. `PATCH /api/sessions/:id` accepts `skipSlow`
  (boolean, otherwise 400 "Leave-slow-sellers must be true or false.").

## Demand rule: `lib/demand.ts` (pure, client-safe)

```ts
export type Demand = "fast" | "normal" | "slow";
export function demand(stats: MarketplaceStats | null, s: Settings["demand"]): Demand | null;
```

- It returns `null` when `stats` is null, `have` or `want` is missing, or both are 0.
- The ratio is `want / have`. When `have` is 0 and `want` is above 0, the ratio counts as `Infinity`.
- **fast:** `ratio >= s.fastWantHave && numForSale <= s.fastMaxForSale`.
- **slow:** `ratio < s.slowWantHave || numForSale >= s.slowForSale`.
- **normal:** neither.
- Fast is checked first. Validation makes the two sets disjoint anyway.

## Settings

- `settings.json` gets
  `"demand": { "fastWantHave": 1, "fastMaxForSale": 10, "slowWantHave": 0.3, "slowForSale": 200 }`.
- `Settings.demand` is added in `lib/types.ts` and validated in `lib/settings.ts`:
  - each value is a finite number ≥ 0, and for-sale counts are integers;
  - `fastWantHave > slowWantHave` and `fastMaxForSale < slowForSale`, each with its own error message.
- The settings store, form conversion, the `/settings` form (a "Demand" card) and `lib/settings-help.ts` (every
  field has help) all cover the new group. Saved rows from before this phase get the defaults.

## UI

- **Badge:** a shared `components/ui/DemandBadge.tsx`. It shows "Sells fast" or "Slow seller" for `fast`/`slow`
  and renders nothing for `normal` or `null`.
  - It's a `<span>` with an accessible label and a `title` giving the counts, for example
    "3,357 want · 878 have · 6 for sale".
  - Colours come from the existing tokens, matching the status pills: fast uses `--accent` on `--accent-soft`
    (like `.s-ok`), slow uses `--warn` on `--notice-bg` with a `--warn-line` border (like `.s-pick`). The
    contrast test covers both themes.
- **Single-record card** (`components/lookup/Lookup.tsx`):
  - the badge sits beside the "Market value" heading;
  - the stats list gains "Want / have", for example "3,357 / 878", shown only when both are known;
  - prices are labelled with the settings currency.
- **Lot rows** (`components/collection/ItemRow.tsx`): the badge is in `.row-meta`, next to the existing "Data
  provided by Discogs" link, on every layout.
- **Totals bar:** `Totals.slow` counts rows with a market value and `demand === "slow"`. The bar shows "N slow" when
  N > 0.
- **Offer panel:** a checkbox "Leave slow sellers out of cherry-picks", saved to `skipSlow`. It changes the
  cherry-pick offer only; the whole-collection offer still values slow records as picks (you buy them either way).
- **Discogs terms:** the badge and counts appear only where the release credit already sits. The single-record card
  and lot rows both have it, and `tests/discogs-terms.test.ts` gains a check that the badge is used only in files
  that carry the credit.

## Offer

- `OfferInputs` gains `skipSlow: boolean`, taken from `lot.skipSlow`.
- Automatic pick: a row is a pick when it isn't pinned, meets the threshold, and isn't
  (`inputs.skipSlow && demand(item.stats, settings.demand) === "slow"`). Pins (`pick` true or false) still win.
  `isPickRow` and `computeOffer` stay pure.
- skipSlow narrows the **cherry-pick** side only (picks count, value, walk-away and ladder). The whole-collection
  side is computed with skipSlow off, so toggling it never changes the whole-collection offer (decided 2026-10-07).

## Tests

- **`demand`:** each threshold edge (exactly 1, 10, 0.3, 200), have 0 with want above 0, both 0, missing fields,
  and null stats.
- **`parseReleaseStats`:** a fixture trimmed from the live Blue Train response, plus a body missing `community`,
  `identifiers` or `master_id`.
- **Client:** `releaseStats` requests `/releases/{id}`, and a 404 gives the empty result.
- **Cache:** results are cached under `release:<id>`. The worker still makes exactly two Discogs calls per record.
- **Settings:** the defaults parse; each new validation error; every new field has help; the form round-trips.
- **Migration 6:** `skip_slow` defaults to 0. The session PATCH accepts `skipSlow` and rejects non-booleans.
- **Offer:** `skipSlow` drops slow auto-picks, keeps pinned slow rows, and has no effect when off.
- **View:** `Totals.slow` counts only valued slow rows. Expired rows (hidden stats) don't count.
- **Terms:** a `DemandBadge` appears only in files with the credit.
- **Lookup:** the single-record result uses the settings currency.

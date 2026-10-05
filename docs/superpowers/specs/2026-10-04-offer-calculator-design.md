# Phase 5: Offer calculator

Date: 2026-10-04 · Status: approved design, awaiting spec review
Builds on: `docs/superpowers/specs/2026-10-04-collection-mode-design.md` (lots, rows, read-time pricing)

## Why

When buying a collection, the owner stands in front of a seller with a priced lot and needs to know what to offer.
They want an opening number, the rungs above it, and the most they can pay and still make their margin. They want
this for the whole lot and for just the valuable records (cherry-picks), so they can choose which deal to propose.
Remote buys (photos only) need a discount for condition they can't check.

Success:
- The lot page shows two offers, cherry-picks only and whole lot. Each has a ladder (30/40/50/60%, opening at 40%) and
  a walk-away amount.
- Offers update when grades, picks or lot inputs change, with no Discogs calls.
- Unpriced rows never silently disappear: they are counted as bulk, and the screen says so.

## Decisions (from brainstorming)

- **Output:** a ladder plus walk-away for both the cherry-pick offer and the whole-lot offer.
- **Ladder base:** percentages of the market **suggested** value (easy to explain to a seller).
- **Overhead:** a per-record cost from settings plus a per-lot amount entered on each lot.
- **Margin:** a percentage of net resale (resale after the Discogs fee).
- **Cherry-picks:** rows at or above a per-lot $ threshold are picks automatically. The owner can override any row.
- **Bulk:** non-picks are counted at a flat $ per record (per lot, default from settings).
- **Unverified condition:** a per-lot switch that lowers record and sleeve grades N steps for the offer maths only.
- **Unpriced rows** (to pick, no price, no match, error, pending): counted as bulk, with a warning.
- **Where:** calculated on the server when the lot is read, like totals, and shown in a panel on the lot page.

## 1. Maths (`lib/offer.ts`, pure)

No network, fs or DB. Inputs are `ItemRow[]`, the lot's offer inputs and `Settings`. It reuses `marketValue`,
`sellPrice` and `downgrade` from `lib/pricing.ts`.

**Per row**
- Offer grades: the row's record and sleeve grades, or `downgrade(grade, unverifiedSteps)` for both when the lot is
  unverified. The row's stored and displayed grades are unchanged.
- `market = marketValue(suggestions, offerRecord, offerSleeve, settings)`. A row is **unpriced** when it has no
  suggestions or `market` is null (this includes a downgrade that lands on a grade Discogs has no data for).
- `net = sellPrice(market, lowestListing, settings).price × (1 − discogsFeePercent / 100)`.
- `isPick`: false for unpriced rows. Otherwise the row's `pick` pin when set, else `market.suggested ≥ pickThreshold`.

**Per lot**
- `picks` = count of pick rows, `pickValue` = Σ `market.suggested` over picks, `pickNet` = Σ `net` over picks.
- `bulkCount` = all other rows (non-pick priced rows plus unpriced rows). `unpricedCount` is reported separately.
- `pickRoom = pickNet × (1 − marginPercent / 100) − overheadPerRecord × picks − lotOverhead` (can be negative).
- `pickWalkAway = max(0, floor(pickRoom))`.
- `wholeWalkAway = max(0, floor(pickRoom + bulkEach × bulkCount))`. The whole lot still has to pay for any lot
  overhead the picks don't cover (amended after final review). Bulk records are counted at cost: per-record overhead
  applies to picks only, since bulk goes to dollar bins without new sleeves or listing.

| | Pick-only offer | Whole-lot offer |
|---|---|---|
| Rung amount for percent r | `floor(r/100 × pickValue)` | `floor(r/100 × pickValue + bulkEach × bulkCount)` |
| `keep` (shown per rung) | `pickWalkAway − amount` | `wholeWalkAway − amount` |
| `overMax` | `amount > pickWalkAway` | `amount > wholeWalkAway` |
| Walk-away | `pickWalkAway` | `wholeWalkAway` |

All offer amounts are whole dollars, rounded down. `keep` is the gap between the offer and the walk-away, so it is
how much room is left above the margin. It can be negative, and in that case `overMax` is true.

**Settings** (`settings.json`, validated in `lib/settings.ts`, type added to `Settings` in `lib/types.ts`):

```json
"offer": {
  "ladderPercents": [30, 40, 50, 60],
  "openingPercent": 40,
  "marginPercent": 30,
  "overheadPerRecord": 1.5,
  "pickThreshold": 15,
  "bulkEach": 0.5,
  "unverifiedSteps": 1
}
```

Validation:
- `ladderPercents`: 1–8 numbers, each in (0, 100], strictly ascending.
- `openingPercent`: must be one of `ladderPercents`.
- `marginPercent` in [0, 100).
- `overheadPerRecord`, `pickThreshold`, `bulkEach` ≥ 0.
- `unverifiedSteps`: an integer from 1 to 3.

Margin, ladder, per-record overhead and unverified steps are settings-only until the phase 6 settings UI.

**Result shape** (`OfferView`):

```ts
type Rung = { percent: number; amount: number; keep: number; overMax: boolean };
type OfferSide = { rungs: Rung[]; walkAway: number };
type OfferView = {
  inputs: {
    unverified: boolean; unverifiedSteps: number; pickThreshold: number; bulkEach: number;
    lotOverhead: number; overheadPerRecord: number; marginPercent: number;
  };
  openingPercent: number;
  picks: number; bulkCount: number; unpricedCount: number;
  pickValue: number; pickNet: number;  // cents-rounded
  pickOnly: OfferSide;
  wholeLot: OfferSide;
};
```

`lib/offer.ts` also exports `isPickRow(item, inputs, settings): boolean` so `toItemView` can show the marker with the
same rule.

## 2. Data model

Migration 2 is appended to `lib/migrations.ts`. Shipped steps are never edited.

```sql
ALTER TABLE sessions ADD COLUMN unverified     INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN pick_threshold REAL;      -- null = settings default
ALTER TABLE sessions ADD COLUMN bulk_each      REAL;      -- null = settings default
ALTER TABLE sessions ADD COLUMN lot_overhead   REAL NOT NULL DEFAULT 0;
ALTER TABLE items    ADD COLUMN pick           INTEGER;   -- null = automatic, 1 = pick, 0 = not a pick
```

- `SessionRow` gains `unverified: boolean`, `pickThreshold: number | null`, `bulkEach: number | null`,
  `lotOverhead: number`. `ItemRow` gains `pick: boolean | null`.
- Null threshold or bulk means "use the settings value", so existing lots work and settings changes flow through.
- The worker still writes only lookup columns. It never writes `pick`. A re-price keeps the pin.

## 3. API

No new routes. Every existing check (session, origin, body caps, `{ status: "error", kind, message }`) still applies.

| Route | Change |
|---|---|
| `PATCH /api/sessions/:id` | Also accepts `unverified` (boolean), `pickThreshold` (number 0–100000 or null), `bulkEach` (number 0–1000 or null), `lotOverhead` (number 0–100000). Returns the session. |
| `PATCH /api/items/:id` | Also accepts `pick` (boolean). 400 if the row has no market value at its offer grades. |
| `GET /api/sessions/:id` | Adds `offer: OfferView` next to `totals`. Each `ItemView` gains `isPick: boolean`. |

Numbers must be finite. Invalid values are 400 with a message naming the field.

## 4. UI

Plain CSS with the existing tokens and accessibility rules (visible labels, 16px inputs, 44px controls on phones,
contrast, focus states, `aria-live` for changes).

**`OfferPanel.tsx`** is a card on `/collection/[id]` between the totals bar and the entry bar.
- **Collapsed by default.** The summary line reads "Offer · open $320 · max $410" (whole-lot opening rung and
  walk-away). It's a button with `aria-expanded`. Its open/closed state is kept in `localStorage` (wrapped in
  try/catch).
- **Inputs row:**
  - *Condition unverified* switch (checkbox styled as a switch, label visible)
  - *Pick threshold* $
  - *Bulk per record* $
  - *Lot overhead* $

  Number inputs save on blur or Enter through `PATCH /api/sessions/:id`. Errors appear inline under the field
  (`aria-describedby`), and the typed value stays.
- **Two columns**, stacked on phones (≤ 480px): *Cherry-picks (12 records)* and *Whole lot (70 records)*.
  - A ladder table for each, with columns Percent · Offer · You keep, in tabular figures.
  - The opening rung is highlighted and labelled "Opening".
  - Rungs over the walk-away are struck through and labelled "over max" in text, not colour alone.
  - **Walk-away $X** in bold under each table.
- **Notes** (shown when they apply):
  - "8 records unpriced, counted as bulk at $0.50 each"
  - "Grades lowered 1 step for this offer (condition unverified)"
  - "Picks: none at or above $15" when `picks` is 0
  - The existing note that Discogs figures are asking prices and suggestions, not sales.
- **Margin line:** "Walk-away keeps a 30% margin after Discogs fees and $1.50/record overhead. Change these in
  settings.json."

**Row pick toggle** (`ItemRow.tsx`): a star button next to the price with `aria-pressed={isPick}` and the label
"Cherry-pick".
- Tapping it sends `pick: !isPick`, which pins the row. There is no "back to automatic" control.
- It's hidden on rows with no market value.
- Phones get a 44px tap target.

## 5. Testing and rollout

Tests (`npm test`; typecheck and build stay green):
- `tests/offer.test.ts`
  - ladder amounts round down to whole dollars; `keep` and `overMax`
  - walk-away formula, overhead on picks only, $0 floor
  - threshold boundary (equal counts as a pick), pin in, pin out
  - unpriced rows (no suggestions, missing grade) counted as bulk and never picks
  - unverified downgrades both grades by the configured steps; a downgrade to a grade with no data becomes unpriced
  - null lot threshold or bulk falls back to settings
  - empty lot: zeros, no crash
- `tests/settings.test.ts`: the offer block is validated (ascending ladder, opening in the ladder, ranges, steps).
- Route tests:
  - the new session PATCH fields, valid and invalid
  - `pick` accepted on a priced row, rejected on an unpriced row
  - `offer` and `isPick` present in GET
- DB test: migration 2 adds the columns with the right defaults to a database already at version 1.
- Worker test: a re-price keeps `pick`.

Rollout:
- Feature branch `feat/offer-calculator`, then a PR. Merging to `main` deploys, and migration 2 runs at startup.
- Phone check: open a lot, expand the offer, change the threshold, pin and unpin a row, and switch unverified on.
- Update CLAUDE.md (layout, status) and the README.

## Out of scope

Per-lot margin, ladder or per-record overhead (phase 6 settings UI); printing or exporting the offer (phase 7);
recording the price paid (phase 8); an offer on the single-record page; a "back to automatic" control for picks.

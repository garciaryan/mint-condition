# Offer Calculator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a cherry-pick offer and a whole-lot offer (ladder plus walk-away) on each lot page, calculated when the
lot is read.

**Architecture:** A pure `lib/offer.ts` turns a lot's `ItemRow[]`, its per-lot offer inputs and `Settings` into an
`OfferView`. `GET /api/sessions/:id` returns it next to `totals`. Migration 2 stores the per-lot inputs on `sessions`
and a per-row `pick` pin on `items`. A new `OfferPanel.tsx` shows the offer, and `ItemRow.tsx` gets a star toggle.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, `node:sqlite`, Node's built-in test runner.

**Spec:** `docs/superpowers/specs/2026-10-04-offer-calculator-design.md`

## Global Constraints

- `lib/offer.ts` and `lib/pricing.ts` stay pure: no network, fs or DB. All tunables come from `settings.json`.
- Migrations are append-only. Never edit migration 1.
- The worker writes only lookup columns. It never writes `pick`, grades, year or query.
- Offer amounts are whole dollars, rounded **down**. Apply `Math.floor` after `roundCents` so float error never drops
  a dollar.
- No new runtime dependencies. Plain CSS with existing tokens in `app/globals.css`.
- Accessibility: visible labels, 16px inputs, 44px controls on phones (≤ 480px), "over max" is shown in text not
  colour alone, inline errors via `aria-describedby`.
- Copy keeps the note that Discogs figures are asking prices and suggestions, not sales.
- Run a single test file with `node --experimental-strip-types --no-warnings --test tests/<file>.test.ts`. Run all
  with `npm test`, plus `npm run typecheck`. Both must stay green after every task.
- Work on branch `feat/offer-calculator`. Do not push to `main`, because every push to `main` deploys.

## Review Focus

1. **A pinned pick that loses its market value** (grade lowered, or the lot switched to unverified) must count as
   bulk, not vanish or crash, and its pin must survive. Test is in Task 2.
2. **Float error in ladder maths:** 29% of $100 must give $29, not $28. Test is in Task 2.
3. **Polling overwriting typed input:** the lot polls every 2–15 s. An offer input being edited must not be reset by a
   poll. Manual check is in Task 5.
4. **Non-numeric or out-of-range offer inputs** (`"abc"`, `NaN` encoded as a string, negative, `Infinity` via
   `1e999`, above the cap) must be 400 with the field named, never stored. Test is in Task 4.
5. **A lot where nothing is priced yet** (all rows pending just after a paste) must show $0 cherry-pick offers and a
   whole-lot offer of `bulkEach × count`, without errors. Test is in Task 2.

---

### Task 1: Offer settings

**Files:**
- Modify: `lib/types.ts` (the `Settings` type)
- Modify: `lib/settings.ts` (`parseSettings`)
- Modify: `settings.json`
- Create: `tests/settings.test.ts`

**Interfaces:**
- Produces: `Settings["offer"]` =
  `{ ladderPercents: number[]; openingPercent: number; marginPercent: number; overheadPerRecord: number; pickThreshold: number; bulkEach: number; unverifiedSteps: number }`

- [ ] **Step 1: Write the failing tests** in `tests/settings.test.ts`. Load the repo `settings.json` with
  `parseSettings` as `tests/pricing.test.ts` does, then:

```ts
test("settings.json has the offer defaults", () => {
  assert.deepEqual(settings.offer, {
    ladderPercents: [30, 40, 50, 60], openingPercent: 40, marginPercent: 30,
    overheadPerRecord: 1.5, pickThreshold: 15, bulkEach: 0.5, unverifiedSteps: 1,
  });
});

const withOffer = (o: Partial<Settings["offer"]>) => ({ ...settings, offer: { ...settings.offer, ...o } });

test("offer block is validated", () => {
  assert.throws(() => parseSettings({ ...settings, offer: undefined }), /offer/);
  assert.throws(() => parseSettings(withOffer({ ladderPercents: [] })), /ladderPercents/);
  assert.throws(() => parseSettings(withOffer({ ladderPercents: [10, 20, 30, 40, 50, 60, 70, 80, 90] })), /ladderPercents/);
  assert.throws(() => parseSettings(withOffer({ ladderPercents: [40, 30] })), /ladderPercents/);
  assert.throws(() => parseSettings(withOffer({ ladderPercents: [0, 40] })), /ladderPercents/);
  assert.throws(() => parseSettings(withOffer({ ladderPercents: [40, 101] })), /ladderPercents/);
  assert.throws(() => parseSettings(withOffer({ openingPercent: 45 })), /openingPercent/);
  assert.throws(() => parseSettings(withOffer({ marginPercent: 100 })), /marginPercent/);
  assert.throws(() => parseSettings(withOffer({ marginPercent: -1 })), /marginPercent/);
  assert.throws(() => parseSettings(withOffer({ overheadPerRecord: -1 })), /overheadPerRecord/);
  assert.throws(() => parseSettings(withOffer({ pickThreshold: -1 })), /pickThreshold/);
  assert.throws(() => parseSettings(withOffer({ bulkEach: -0.5 })), /bulkEach/);
  assert.throws(() => parseSettings(withOffer({ unverifiedSteps: 0 })), /unverifiedSteps/);
  assert.throws(() => parseSettings(withOffer({ unverifiedSteps: 4 })), /unverifiedSteps/);
  assert.throws(() => parseSettings(withOffer({ unverifiedSteps: 1.5 })), /unverifiedSteps/);
  assert.doesNotThrow(() => parseSettings(withOffer({ ladderPercents: [100], openingPercent: 100, marginPercent: 0 })));
});
```

- [ ] **Step 2: Run** `node --experimental-strip-types --no-warnings --test tests/settings.test.ts`. Expected: FAIL
  (`settings.offer` is undefined).
- [ ] **Step 3: Implement.** Add `offer` to `Settings`, add the spec's `offer` block to `settings.json`, and validate
  it in `parseSettings`. Every message starts `settings: offer.<field>` (missing block: `settings: offer must be an
  object`). Rules:
  - `ladderPercents`: 1–8 finite numbers in (0, 100], strictly ascending.
  - `openingPercent`: one of `ladderPercents`.
  - `marginPercent`: in [0, 100).
  - `overheadPerRecord`, `pickThreshold`, `bulkEach`: finite and ≥ 0.
  - `unverifiedSteps`: an integer from 1 to 3.
- [ ] **Step 4: Run** the file again, then `npm test` and `npm run typecheck`. Expected: all PASS.
- [ ] **Step 5: Commit** `feat(offer): offer settings block and validation`.

---

### Task 2: Pure offer maths (`lib/offer.ts`)

**Files:**
- Modify: `lib/collection/types.ts` (add `pick: boolean | null` to `ItemRow`)
- Modify: `lib/collection/store.ts` (`toItem` sets `pick: null` for now; Task 3 reads the column)
- Modify: `tests/collection-view.test.ts` and any other `ItemRow` fixture (add `pick: null` to the defaults)
- Create: `lib/offer.ts`
- Create: `tests/offer.test.ts`

**Interfaces:**
- Consumes: `marketValue`, `sellPrice`, `downgrade`, `roundCents` from `lib/pricing.ts`; `Settings["offer"]`.
- Produces (all exported from `lib/offer.ts`):

```ts
export type OfferInputs = { unverified: boolean; pickThreshold: number; bulkEach: number; lotOverhead: number };
export type Rung = { percent: number; amount: number; keep: number; overMax: boolean };
export type OfferSide = { rungs: Rung[]; walkAway: number };
export type OfferView = {
  inputs: OfferInputs & { unverifiedSteps: number; overheadPerRecord: number; marginPercent: number };
  openingPercent: number;
  picks: number; bulkCount: number; unpricedCount: number;
  pickValue: number; pickNet: number;
  pickOnly: OfferSide; wholeLot: OfferSide;
};
export function offerInputs(
  lot: { unverified: boolean; pickThreshold: number | null; bulkEach: number | null; lotOverhead: number },
  settings: Settings,
): OfferInputs;                                   // null threshold/bulk -> settings.offer values
export function offerMarket(item: ItemRow, inputs: OfferInputs, settings: Settings): MarketValue | null;
export function isPickRow(item: ItemRow, inputs: OfferInputs, settings: Settings): boolean;
export function computeOffer(items: ItemRow[], inputs: OfferInputs, settings: Settings): OfferView;
```

- [ ] **Step 1: Write the failing tests** in `tests/offer.test.ts`. Load `settings` from `settings.json`. Reuse the
  `item()` fixture shape from `tests/collection-view.test.ts` (with `pick: null`). All rows use sleeve `NM`
  (multiplier 1.0) unless stated. Fixture rows:
  - `A`: record `VG+`, suggestions `{ NM: 40, "VG+": 30, VG: 20 }`, stats lowestPrice 12, status `priced` → suggested
    30.
  - `B`: record `VG+`, suggestions `{ NM: 12, "VG+": 10, VG: 6 }`, status `priced` → suggested 10.
  - `C`: status `pending`, no suggestions.
  - `base` = `offerInputs({ unverified: false, pickThreshold: null, bulkEach: null, lotOverhead: 0 }, settings)`.

```ts
test("offerInputs falls back to settings for null threshold and bulk", () => {
  assert.deepEqual(base, { unverified: false, pickThreshold: 15, bulkEach: 0.5, lotOverhead: 0 });
  assert.deepEqual(offerInputs({ unverified: true, pickThreshold: 5, bulkEach: 1, lotOverhead: 20 }, settings),
    { unverified: true, pickThreshold: 5, bulkEach: 1, lotOverhead: 20 });
});

test("ladder and walk-away for picks and whole lot", () => {
  const o = computeOffer([A, B, C], base, settings);
  assert.equal(o.picks, 1); assert.equal(o.bulkCount, 2); assert.equal(o.unpricedCount, 1);
  assert.equal(o.pickValue, 30); assert.equal(o.pickNet, 26.48);   // 30 * 0.97 * 0.91
  assert.equal(o.openingPercent, 40);
  assert.equal(o.pickOnly.walkAway, 17);                           // floor(26.481 * 0.7 - 1.5)
  assert.deepEqual(o.pickOnly.rungs.map((r) => [r.percent, r.amount, r.keep, r.overMax]),
    [[30, 9, 8, false], [40, 12, 5, false], [50, 15, 2, false], [60, 18, -1, true]]);
  assert.equal(o.wholeLot.walkAway, 18);                           // 17 + 0.5 * 2
  assert.deepEqual(o.wholeLot.rungs.map((r) => [r.amount, r.overMax]),
    [[10, false], [13, false], [16, false], [19, true]]);
  assert.deepEqual(o.inputs, { ...base, unverifiedSteps: 1, overheadPerRecord: 1.5, marginPercent: 30 });
});

test("threshold is inclusive; pins override it", () => {
  const at15 = item({ ...A, suggestions: { NM: 20, "VG+": 15, VG: 10 } });
  assert.equal(isPickRow(at15, base, settings), true);
  assert.equal(computeOffer([{ ...A, pick: false }, B], base, settings).picks, 0);
  assert.equal(computeOffer([A, { ...B, pick: true }], base, settings).picks, 2);
});

test("unpriced rows are bulk and never picks, even when pinned", () => {
  const pinned = { ...C, pick: true };
  assert.equal(isPickRow(pinned, base, settings), false);
  assert.equal(computeOffer([pinned], base, settings).bulkCount, 1);
});

test("unverified lowers both grades; a missing grade becomes unpriced but keeps its pin", () => {
  const u = { ...base, unverified: true };
  assert.equal(offerMarket(A, u, settings)!.suggested, 19);       // VG 20 * sleeve VG+ 0.95
  const noG = item({ ...A, record: "VG", pick: true });            // VG -> G+, no G+ suggestion
  assert.equal(offerMarket(noG, u, settings), null);
  const o = computeOffer([noG], u, settings);
  assert.equal(o.picks, 0); assert.equal(o.unpricedCount, 1);   // pin survival in the DB is tested in Task 3
});

test("lot overhead floors pick walk-away at 0", () => {
  const o = computeOffer([A, B, C], { ...base, lotOverhead: 20 }, settings);
  assert.equal(o.pickOnly.walkAway, 0); assert.equal(o.wholeLot.walkAway, 1);
});

test("nothing priced yet: zero picks, whole lot is bulk", () => {
  const o = computeOffer([C, { ...C, id: 99 }], base, settings);
  assert.equal(o.picks, 0); assert.equal(o.pickValue, 0);
  assert.ok(o.pickOnly.rungs.every((r) => r.amount === 0 && !r.overMax));
  assert.equal(o.wholeLot.walkAway, 1);
  assert.deepEqual(o.wholeLot.rungs.map((r) => r.amount), [1, 1, 1, 1]);
});

test("empty lot", () => {
  const o = computeOffer([], base, settings);
  assert.equal(o.picks + o.bulkCount, 0); assert.equal(o.wholeLot.walkAway, 0);
});

test("floor is applied after rounding to cents (29% of $100 is $29)", () => {
  const s = parseSettings({ ...settings, offer: { ...settings.offer, ladderPercents: [29], openingPercent: 29 } });
  const hundred = item({ ...A, suggestions: { NM: 120, "VG+": 100, VG: 80 } });
  assert.equal(computeOffer([hundred], base, s).pickOnly.rungs[0].amount, 29);
});
```

- [ ] **Step 2: Run** `node --experimental-strip-types --no-warnings --test tests/offer.test.ts`. Expected: FAIL
  (module not found).
- [ ] **Step 3: Implement `lib/offer.ts`** following spec §1 exactly:
  - `offerMarket` uses `downgrade(grade, settings.offer.unverifiedSteps)` on both grades when `inputs.unverified`,
    and returns null when there are no suggestions.
  - `computeOffer` sums unrounded `net` values. It reports `pickValue`/`pickNet` with `roundCents`, and computes
    every whole-dollar amount as `Math.floor(roundCents(x))`.
  - `pickWalkAway = max(0, ...)` is computed before `wholeWalkAway` adds bulk.
  - The row update in `store.ts`/fixtures is just `pick: null`.
- [ ] **Step 4: Run** the file, then `npm test` and `npm run typecheck`. Expected: all PASS.
- [ ] **Step 5: Commit** `feat(offer): pure offer maths`.

---

### Task 3: Migration 2 and store

**Files:**
- Modify: `lib/migrations.ts` (append step 2)
- Modify: `lib/collection/types.ts` (`SessionRow` fields)
- Modify: `lib/collection/store.ts` (`toSession`, `toItem`, `LIST_COLUMNS`, `updateSession`, new `setItemPick`)
- Modify: `tests/db.test.ts`, `tests/collection-store.test.ts`

**Interfaces:**
- Consumes: `ItemRow.pick` from Task 2.
- Produces:
  - `SessionRow` gains `unverified: boolean; pickThreshold: number | null; bulkEach: number | null; lotOverhead: number`.
  - `updateSession(db, id, patch: { name?; defaultRecord?; defaultSleeve?; unverified?: boolean; pickThreshold?: number | null; bulkEach?: number | null; lotOverhead?: number }, now)`.
    Fields that are `undefined` are left unchanged. An explicit `null` stores null.
  - `setItemPick(db: DatabaseSync, id: number, pick: boolean): ItemRow | null`.

- [ ] **Step 1: Write the failing tests.**
  - `tests/db.test.ts` "migration 2 adds offer columns to a version-1 database": migrate with `[migrations[0]]`,
    insert a session and an item, then migrate with `migrations`. Assert `user_version` is 2, and the existing session
    reads `unverified = 0`, `pick_threshold`/`bulk_each` null, `lot_overhead = 0`, and the item reads `pick` null.
  - `tests/collection-store.test.ts`:
    - "updateSession saves offer inputs and keeps others": set `{ unverified: true, pickThreshold: 20, bulkEach: 1,
      lotOverhead: 25 }`, then `{ name: "X" }`. The second call leaves the offer fields as they were. Then
      `{ pickThreshold: null }` resets only the threshold to null.
    - "setItemPick pins and survives re-price and lookup": `setItemPick(db, id, true)`, then `repriceSession`, then
      `applyLookup(db, id, { status: "priced", suggestions, stats, pricedAt: 1 })`. `getItem(...).pick` and the
      `listItems` row's `pick` are both `true`. `setItemPick` on a missing id returns null.
- [ ] **Step 2: Run** both files. Expected: FAIL.
- [ ] **Step 3: Implement.** Append the spec §2 SQL as `migrations[1]`. Map `unverified`/`pick` integers to booleans
  (`pick` null stays null). Add `pick` to `LIST_COLUMNS`. `updateSession` writes all session columns, using
  `patch.x !== undefined ? patch.x : cur.x`.
- [ ] **Step 4: Run** the files, then `npm test` and `npm run typecheck`. Expected: all PASS.
- [ ] **Step 5: Commit** `feat(offer): migration 2, lot offer inputs and row pick in store`.

---

### Task 4: View and API

**Files:**
- Modify: `lib/collection/view.ts` (`ItemView.isPick`, `toItemView` signature)
- Modify: `lib/collection/http.ts` (new `parseAmount`)
- Modify: `app/api/sessions/[id]/route.ts` (GET adds `offer`; PATCH new fields)
- Modify: `app/api/items/[id]/route.ts` (PATCH `pick`)
- Modify: `app/api/items/[id]/retry/route.ts`, `app/api/sessions/[id]/items/route.ts` (pass inputs to `toItemView`)
- Modify: `tests/collection-routes.test.ts`, `tests/collection-view.test.ts`

**Interfaces:**
- Consumes: `offerInputs`, `isPickRow`, `offerMarket`, `computeOffer` (Task 2); `setItemPick`, `updateSession`,
  `SessionRow` (Task 3).
- Produces:
  - `toItemView(item: ItemRow, settings: Settings, inputs: OfferInputs): ItemView`, where `ItemView` gains
    `isPick: boolean`. Routes that return one item load the item's session to build `inputs`.
  - `parseAmount(v: unknown, max: number): number | null`: returns the value for a finite number in `[0, max]`,
    otherwise null.
  - `GET /api/sessions/:id` body adds `offer: OfferView`.

- [ ] **Step 1: Write the failing tests** in `tests/collection-routes.test.ts`, using the existing helpers (`SUG` is
  `{ NM: 30, "VG+": 20, VG: 10 }`; the lot default grades decide each row's value):
  - "GET returns offer and isPick": after one row is priced at suggested ≥ 15, `body.offer.picks === 1`,
    `body.items[0].isPick === true`, and `body.offer.pickOnly.rungs.length === 4`.
  - "PATCH session offer inputs": `{ unverified: true, pickThreshold: 25, bulkEach: 1, lotOverhead: 10 }` returns 200
    and the session echoes them. A following GET shows `offer.inputs.pickThreshold === 25`. `{ pickThreshold: null }`
    gives `offer.inputs.pickThreshold === 15`.
  - "PATCH session rejects bad offer inputs": each of `{ pickThreshold: "abc" }`, `{ pickThreshold: -1 }`,
    `{ pickThreshold: 100001 }`, `{ bulkEach: 1001 }`, `{ bulkEach: "1" }`, `{ lotOverhead: null }`,
    `{ lotOverhead: 1e999 }` (sent as a raw body string, which parses to `Infinity`) and `{ unverified: "yes" }` is
    400, and the message contains the field name. A GET afterwards shows the inputs unchanged.
  - "PATCH item pick": `{ pick: false }` on the priced pick returns 200 with `isPick === false`, and GET shows
    `offer.picks === 0`. `{ pick: "no" }` is 400. `{ pick: true }` on a pending row is 400 with message
    "This record has no market value to cherry-pick."
  - In `tests/collection-view.test.ts`, update existing `toItemView` calls to pass
    `offerInputs({ unverified: false, pickThreshold: null, bulkEach: null, lotOverhead: 0 }, settings)`.
- [ ] **Step 2: Run** `tests/collection-routes.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Session PATCH validation:
    - `unverified`: boolean.
    - `pickThreshold`: `null` or `parseAmount(v, 100000)`.
    - `bulkEach`: `null` or `parseAmount(v, 1000)`.
    - `lotOverhead`: `parseAmount(v, 100000)`, not nullable.

    Messages: "Pick threshold must be empty or 0 to 100000.", "Bulk per record must be empty or 0 to 1000.",
    "Lot overhead must be 0 to 100000.", "Condition unverified must be true or false."
  - Item PATCH `pick`: must be a boolean ("Cherry-pick must be true or false."). Inside `withSettings`, load the
    item's session, build `inputs`, and return 400 when `offerMarket(cur, inputs, settings)` is null. Otherwise
    `setItemPick`. Apply grade changes first, so `offerMarket` checks the new grades when both are sent.
  - GET builds `inputs` once and passes it to every `toItemView` and to `computeOffer`.
- [ ] **Step 4: Run** the files, then `npm test` and `npm run typecheck`. Expected: all PASS.
- [ ] **Step 5: Commit** `feat(offer): offer in lot API, offer inputs and pick on PATCH`.

---

### Task 5: Offer panel and pick star

**Files:**
- Create: `app/collection/[id]/OfferPanel.tsx`
- Modify: `app/collection/[id]/api.ts` (`LotData` adds `offer: OfferView`)
- Modify: `app/collection/[id]/LotView.tsx` (render `OfferPanel` between `TotalsBar` and `EntryBar`; a
  `setPick(itemId, pick)` callback like `grade`)
- Modify: `app/collection/[id]/ItemRow.tsx` (star toggle; add a `star` path to `ICONS`)
- Modify: `app/globals.css`
- Modify: `lib/collection/ui.ts` + `tests/collection-ui.test.ts` (pure copy helpers)

**Interfaces:**
- Consumes: `OfferView`, `ItemView.isPick`, `PATCH /api/sessions/:id`, `PATCH /api/items/:id` (Task 4).
- Produces:
  - `OfferPanel({ offer, currency, sessionId, onChanged }: { offer: OfferView; currency: string; sessionId: number; onChanged: () => void })`.
  - In `lib/collection/ui.ts`:
    - `offerSummary(offer: OfferView, currency: string): string` returns `"Offer · open $13 · max $18"`. It uses the
      whole-lot rung whose percent is `openingPercent`, with no cents.
    - `offerNotes(offer: OfferView, currency: string): string[]` returns, in order and only when they apply:
      - `"N records unpriced, counted as bulk at $0.50 each"`
      - `"Grades lowered N step(s) for this offer (condition unverified)"` ("1 step", "2 steps")
      - `"Picks: none at or above $15"` when `picks === 0`

- [ ] **Step 1: Write the failing tests** in `tests/collection-ui.test.ts` for `offerSummary` and `offerNotes`. Use
  the Task 2 `[A, B, C]` offer: summary `"Offer · open $13 · max $18"`, and notes
  `["1 record unpriced, counted as bulk at $0.50 each"]` (singular "record" for 1). Add an unverified, all-unpriced
  case that returns all three notes, with "1 step".
- [ ] **Step 2: Run** the file. Expected: FAIL.
- [ ] **Step 3: Implement the helpers**, then the UI per spec §4:
  - The panel is collapsed by default, with the toggle state stored under `localStorage` key `offerPanelOpen`
    (try/catch on every access). The summary button has `aria-expanded` and `aria-controls`.
  - Inputs:
    - The *Condition unverified* checkbox saves on change.
    - *Pick threshold $*, *Bulk per record $* and *Lot overhead $* use `inputMode="decimal"` and save on blur or Enter.
    - An empty threshold or bulk sends `null` (the settings default; the placeholder shows that value). An empty
      overhead sends `0`.
    - **Each field keeps a local draft while focused or after a failed save. Polled `offer` values replace the draft
      only when the field isn't focused and has no error.**
    - An error shows under the field (`aria-describedby`) and keeps the typed text.
  - Two `<table>`s with caption *Cherry-picks (N records)* / *Whole lot (N records)* and columns Percent · Offer ·
    You keep:
    - The opening row is labelled "Opening".
    - `overMax` rows get a `<s>` around the amount plus the text "over max".
    - **Walk-away $X** sits under each table.
    - The tables stack at ≤ 480px.
  - Below the tables: the notes, then "Walk-away keeps a {marginPercent}% margin after Discogs fees and
    ${overheadPerRecord}/record overhead. Change these in settings.json.", then "Discogs figures are asking prices
    and suggestions, not sales."
  - Star in `ItemRow`:
    - Shown only when `item.market`.
    - It's a `<button aria-pressed={item.isPick} aria-label="Cherry-pick">`, 44px on phones.
    - A click calls `onPick(item.id, !item.isPick)`. A failed save shows the existing notice and refreshes.
- [ ] **Step 4: Run** `npm test`, `npm run typecheck`, `npm run build`. Expected: all PASS.
- [ ] **Step 5: Manual check** with `npm run dev` (login is off locally without APP_* vars):
  - Open a lot with priced rows, expand the offer, and change the threshold.
  - **Type in Pick threshold and wait through two polls without blurring: the text must not reset.**
  - Star and unstar a row and watch the counts change.
  - Toggle unverified.
  - Resize to 375px: tables stack, no horizontal scroll.
- [ ] **Step 6: Commit** `feat(offer): offer panel and cherry-pick star`.

---

### Task 6: Docs

**Files:**
- Modify: `CLAUDE.md` (Layout: `lib/offer.ts`, `OfferPanel`; Status: Phase 5 built on `feat/offer-calculator`, test
  count, deploy and phone check pending; move "Offer calculator" out of Later phases)
- Modify: `README.md` (an "Offers" subsection under collection mode: what the ladder, walk-away, picks, bulk and
  unverified mean, and where the settings live)

- [ ] **Step 1: Update both files.** Get the test count from `npm test` output.
- [ ] **Step 2: Run** `npm test && npm run typecheck`. Expected: PASS.
- [ ] **Step 3: Commit** `docs: phase 5 offer calculator`.

# Demand Signal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Price from `/releases/{id}` in place of `/marketplace/stats/{id}`. Show a fast/slow demand badge and the
want/have counts, and let a collection leave slow sellers out of its automatic picks.

**Architecture:** A pure `lib/demand.ts` classifies a record from `MarketplaceStats` (now carrying have/want) and
`Settings.demand`. The Discogs client's `releaseStats` replaces `marketplaceStats` everywhere, so there are still
two calls per record, and the new fields ride in the existing `stats_json`. Migration 6 adds `sessions.skip_slow`,
which feeds `OfferInputs.skipSlow`.

**Tech Stack:** Next.js 15 App Router, TypeScript, `node:sqlite`, Node's built-in test runner.

**Spec:** `docs/superpowers/specs/2026-10-07-demand-signal-design.md`

## Global Constraints

- Default thresholds:
  `"demand": { "fastWantHave": 1, "fastMaxForSale": 10, "slowWantHave": 0.3, "slowForSale": 200 }`.
- Rule:
  - **fast:** `ratio >= fastWantHave && numForSale <= fastMaxForSale`
  - **slow:** `ratio < slowWantHave || numForSale >= slowForSale`
  - **normal:** neither
  - **null:** stats null, have or want missing, or both 0
  - `have` 0 with `want` above 0 counts as a ratio of `Infinity`
- Copy: badge "Sells fast" / "Slow seller". Stats row "Want / have". Totals "N slow". Checkbox "Leave slow sellers
  out of picks". Error "Leave-slow-sellers must be true or false." User-visible text says "collection", never
  "lot".
- Cache key `release:<id>`. Exactly two Discogs calls per priced record.
- `lib/pricing.ts`, `lib/offer.ts` and `lib/demand.ts` stay pure. `lib/` keeps relative imports. Components use `@/`.
- Colours only from tokens: fast uses `--accent` on `--accent-soft`; slow uses `--warn` on `--notice-bg` with a
  `--warn-line` border.
- Migrations are append-only: this is step 6.
- After every task: `npm test` and `npm run typecheck` pass.
- **Dev server:** the owner's `next dev` may be running on :3000. Check pages through it with GET requests only.
  Run `npm run build` only when `pgrep -f "next dev"` shows nothing, or in a scratch `git worktree`.

## Review Focus

1. A lot row priced before this phase (`stats_json` without have/want) must show no badge, not count as slow, and
   not be skipped by `skipSlow`. Test in Tasks 1 and 3.
2. A release with a `community` object but no `have`/`want` keys, or `master_id: 0`, must parse to undefined have/want
   and `masterId: null`, with no NaN. Test in Task 2.
3. An expired row (stats hidden by `hideExpired`) must not count in `Totals.slow`. Test in Task 3.
4. Saved settings from before this phase (no `demand` key) must load with the defaults, and the `/settings` form
   must show them. Test in Task 4.
5. A slow row the owner starred (`pick: true`) stays a pick with `skipSlow` on. Test in Task 3.

---

### Task 1: Demand rule and settings

**Files:**
- Create: `lib/demand.ts`, `tests/demand.test.ts`
- Modify: `lib/types.ts` (`Identifier`, optional fields on `MarketplaceStats`, `Settings.demand`), `settings.json`,
  `lib/settings.ts` (`parseDemand`)
- Test: `tests/settings.test.ts`

**Interfaces:**
- Produces:
  - `type Identifier = { type: string; value: string; description?: string }`
  - `MarketplaceStats` gains `have?: number; want?: number; masterId?: number | null; identifiers?: Identifier[]`
  - `Settings["demand"] = { fastWantHave: number; fastMaxForSale: number; slowWantHave: number; slowForSale: number }`
  - `type Demand = "fast" | "normal" | "slow"`
  - `demand(stats: MarketplaceStats | null, s: Settings["demand"]): Demand | null`

- [ ] **Step 1: Write failing tests** in `tests/demand.test.ts`, with `D` the defaults and
  `st = (have, want, numForSale)` building stats:
  - fast at the edges: `st(10, 10, 10)` → `"fast"` (ratio exactly 1, for-sale exactly 10); `st(10, 10, 11)` →
    `"normal"`.
  - slow at the edges: `st(10, 2, 5)` → `"slow"` (0.2); `st(10, 3, 5)` → `"normal"` (exactly 0.3);
    `st(100, 150, 200)` → `"slow"` (for-sale exactly 200); `st(100, 150, 199)` → `"normal"`.
  - `st(0, 5, 3)` → `"fast"` (Infinity); `st(0, 0, 3)` → `null`.
  - `demand(null, D)` → `null`; `demand({ lowestPrice: 1, currency: null, numForSale: 3 }, D)` → `null`, the
    pre-Phase-10 row.

  In `tests/settings.test.ts`:
  - `parseSettings` of `settings.json` has `demand` equal to the defaults.
  - Each of these throws with the named path: a negative `fastWantHave`; a non-integer `slowForSale`
    (`demand.slowForSale`); `fastWantHave <= slowWantHave` (message contains `demand.fastWantHave must be greater
    than demand.slowWantHave`); `fastMaxForSale >= slowForSale` (message contains `demand.fastMaxForSale must be
    less than demand.slowForSale`).
- [ ] **Step 2: Run** `npm test`. Expected: FAIL.
- [ ] **Step 3: Implement** the types, the `settings.json` defaults, `parseDemand` in `lib/settings.ts`, and
  `demand()`. `parseDemand` follows `parseOffer`'s style and messages: `settings: demand.<key> must be ...`.
- [ ] **Step 4: Run** `npm test && npm run typecheck`. Expected: PASS. Fix any test fixture that builds a full
  `Settings` by adding `demand`.
- [ ] **Step 5: Commit** `feat(demand): demand rule and thresholds in settings`.

### Task 2: `releaseStats` replaces `marketplaceStats`

**Files:**
- Modify: `lib/discogs.ts` (`parseReleaseStats`, `releaseStats`; remove `marketplaceStats`),
  `lib/discogs-cache.ts` (`releaseStats`, key `release:<id>`), `lib/lookup.ts` (`LookupClient.releaseStats`;
  `currency: settings.discogs.currency`), `lib/collection/worker.ts`, `components/lookup/Lookup.tsx` (currency label
  from the response's `currency`, now always the settings currency)
- Create: `tests/fixtures/release-5193282.json`, a trimmed copy of the live response from the spec, keeping `id`,
  `num_for_sale`, `lowest_price`, `master_id`, `community` (have, want, rating) and `identifiers`
- Test: `tests/discogs.test.ts`, `tests/discogs-cache.test.ts`, `tests/lookup.test.ts`,
  `tests/collection-worker.test.ts`, `tests/collection-routes.test.ts`, `tests/helpers/live-client.ts` (rename the
  fakes' `marketplaceStats` to `releaseStats`)

**Interfaces:**
- Consumes: `MarketplaceStats` and `Identifier` (Task 1).
- Produces:
  - `parseReleaseStats(body: unknown): MarketplaceStats`
  - `DiscogsClient.releaseStats(releaseId: number): Promise<MarketplaceStats>`
  - The cached and lookup clients expose `releaseStats(releaseId, opts?)` in place of `marketplaceStats`.

- [ ] **Step 1: Write failing tests:**
  - `parseReleaseStats(fixture)` deep-equals `{ lowestPrice: 475, currency: null, numForSale: 6, have: 878,
    want: 3357, masterId: 32208, identifiers: [first 5 identifiers from the fixture] }`.
  - A body `{ num_for_sale: 0, lowest_price: null, community: {}, master_id: 0, identifiers: [{ type: "x" }] }` →
    `{ lowestPrice: null, currency: null, numForSale: 0, masterId: null, identifiers: [] }`, with `have` and `want`
    absent.
  - The client's `releaseStats(42)` requests a URL whose path is `/releases/42`. On a 404 it returns
    `{ lowestPrice: null, currency: null, numForSale: 0 }`. Replace the two old `marketplaceStats` tests.
  - The cache test counts `release:7` where it counted `stats:7`.
  - The worker test asserts that one priced record makes exactly two client calls (suggestions + release).
  - The lookup test asserts that a priced response's `currency` is the settings currency, even when the stats
    currency is null.
- [ ] **Step 2: Run** `npm test`. Expected: FAIL. `releaseStats` is not defined.
- [ ] **Step 3: Implement.** Rename through every caller and fake. `releaseStats` uses the existing `get` with no
  params.
- [ ] **Step 4: Run** `npm test && npm run typecheck`, and confirm `grep -rn "marketplaceStats" lib components app
  tests` is empty. Expected: PASS, empty.
- [ ] **Step 5: Commit** `feat(discogs): price from /releases/{id} (want/have, runouts, master) instead of marketplace stats`.

### Task 3: Migration 6, `skipSlow`, picks and totals

**Files:**
- Modify: `lib/migrations.ts` (step 6), `lib/collection/types.ts` (`SessionRow.skipSlow`, `SessionPatch.skipSlow`),
  `lib/collection/store.ts` (`toSession`, `updateSession`), `app/api/sessions/[id]/route.ts`, `lib/offer.ts`
  (`OfferInputs.skipSlow`, `offerInputs`, `pickFor`), `lib/collection/view.ts` (`Totals.slow`)
- Test: `tests/db.test.ts`, `tests/collection-store.test.ts`, `tests/collection-routes.test.ts`,
  `tests/offer.test.ts`, `tests/collection-view.test.ts`

**Interfaces:**
- Consumes: `demand()` (Task 1).
- Produces:
  - `SessionRow.skipSlow: boolean`
  - `OfferInputs = { unverified; pickThreshold; bulkEach; lotOverhead; skipSlow: boolean }`
  - `Totals.slow: number`

- [ ] **Step 1: Write failing tests:**
  - **db:** `"migration 6 adds sessions.skip_slow to a version-5 database"` (pattern of migration 5) → `skip_slow`
    is 0. Pin the migration 5 test to `migrations.slice(0, 5)`.
  - **store:** `updateSession(db, id, { skipSlow: true })` returns `skipSlow: true`, and other fields are kept.
  - **routes:** PATCH session `{ skipSlow: true }` → 200 with `skipSlow: true`. `{ skipSlow: "yes" }` → 400 with
    "Leave-slow-sellers must be true or false."
  - **offer:** with `slow = stats(have 100, want 10, forSale 50)` on a row worth more than the threshold:
    - `skipSlow` off → pick;
    - `skipSlow` on → not a pick;
    - `skipSlow` on with `pick: true` → pick;
    - `skipSlow` on with a pre-Phase-10 row (no have/want) → pick;
    - `computeOffer` pick counts follow the same rules.
  - **view:** `Totals.slow` counts a valued slow row (1). It doesn't count a slow row with no market value, or a slow
    row after `hideExpired`.
- [ ] **Step 2: Run** `npm test`. Expected: FAIL.
- [ ] **Step 3: Implement.** Mirror `unverified` through the store, route and `offerInputs`. Thread `settings` into
  `pickFor` so it can call `demand(item.stats, settings.demand)`.
- [ ] **Step 4: Run** `npm test && npm run typecheck`. Expected: PASS. Update the `OfferInputs` fixtures with
  `skipSlow: false`.
- [ ] **Step 5: Commit** `feat(offer): leave slow sellers out of automatic picks; slow count in totals`.

### Task 4: Demand settings on `/settings`

**Files:**
- Modify: `lib/settings-form.ts` (`FIELD_KEYS` + `EditableSettings.demand`), `lib/settings-help.ts`,
  `components/settings/SettingsForm.tsx` (a "Demand" card)
- Test: `tests/settings-form.test.ts`, `tests/settings-help.test.ts`, `tests/settings-store.test.ts`

**Interfaces:**
- Consumes: `Settings.demand` (Task 1).
- Produces: field keys `demand.fastWantHave`, `demand.fastMaxForSale`, `demand.slowWantHave` and
  `demand.slowForSale`.

- [ ] **Step 1: Write failing tests:**
  - **form:** `toForm(defaults)` has the four demand keys as `"1"`, `"10"`, `"0.3"` and `"200"`, and `fromForm`
    round-trips them.
  - **help:** the existing "every field has help" test fails until the help is written. Each help text says what
    the value changes, for example "A record sells fast when its want/have is at least this…".
  - **store:** a saved row without `demand` loads with the default `demand`, and the form shows the defaults.
- [ ] **Step 2: Run** `npm test`. Expected: FAIL.
- [ ] **Step 3: Implement** the keys, help and a "Demand" card in `SettingsForm` with four number inputs and
  `HelpTip`s, following the Offer card's markup.
- [ ] **Step 4: Run** `npm test && npm run typecheck`, then GET `/settings` on the running dev server. Expected:
  PASS, 200.
- [ ] **Step 5: Commit** `feat(settings): demand thresholds on /settings`.

### Task 5: Badge, counts and the pick setting in the UI

**Files:**
- Create: `components/ui/DemandBadge.tsx`
- Modify: `components/lookup/Lookup.tsx`, `components/collection/ItemRow.tsx`,
  `components/collection/TotalsBar.tsx`, `components/collection/OfferPanel.tsx`, `lib/collection/view.ts` (`ItemView`
  gains `demand: Demand | null`, `have?: number`, `want?: number`), `lib/lookup.ts` (a priced response gains
  `demand: Demand | null`), `app/globals.css`
- Test: `tests/discogs-terms.test.ts`, `tests/collection-view.test.ts`, `tests/lookup.test.ts`,
  `tests/collection-ui.test.ts`

**Interfaces:**
- Consumes: `demand()` and `Demand` (Task 1); `Totals.slow` and `SessionRow.skipSlow` (Task 3).
- Produces: `DemandBadge({ demand, have, want, forSale }: { demand: Demand | null; have?: number; want?: number;
  forSale: number })`, which renders nothing for `null` or `"normal"`.

- [ ] **Step 1: Write failing tests:**
  - **view:** `toItemView` of a slow row has `demand: "slow"`, `have` and `want`. A pre-Phase-10 row has
    `demand: null`.
  - **lookup:** a priced lookup response carries `demand`.
  - **terms:** every file under `components/` and `app/` that renders `<DemandBadge` also contains `DATA_CREDIT` or
    `DiscogsCredit`. Assert that the list of such files is non-empty, then check each one.
  - **ui (CSS):** `.demand.fast` uses `var(--accent)` / `var(--accent-soft)`, and `.demand.slow` uses
    `var(--warn)` / `var(--notice-bg)` / `var(--warn-line)`.
- [ ] **Step 2: Run** `npm test`. Expected: FAIL.
- [ ] **Step 3: Implement:**
  - **`DemandBadge`:** `<span className={\`demand ${demand}\`} title="3,357 want · 878 have · 6 for sale">`, with
    the visible text "Sells fast" or "Slow seller". The counts are also in an `sr-only` span so they don't depend on
    `title`. Numbers use `toLocaleString("en-US")`.
  - **`Lookup`:** the badge goes beside the "Market value" heading. Add a "Want / have" `<dt>`/`<dd>`, shown only
    when both are known.
  - **`ItemRow`:** the badge goes in `.row-meta` after the subline.
  - **`TotalsBar`:** shows "N slow" when `totals.slow > 0`.
  - **`OfferPanel`:** a "Leave slow sellers out of picks" checkbox next to "Condition unverified", saved with
    `PATCH { skipSlow }` the same way.
  - **CSS:** `.demand` pill styles, tokens only.
- [ ] **Step 4: Run** `npm test && npm run typecheck`, then GET `/`, `/collection`, `/collection/<id>`, `/settings`
  and `/collection/<id>/print` on the dev server. Expected: PASS, all 200.
- [ ] **Step 5: Commit** `feat(demand): fast/slow badge, want/have and slow count; leave-slow-sellers setting`.

### Task 6: Live check and docs

**Files:**
- Modify: `CLAUDE.md` (Status line for Phase 10; Layout gains `lib/demand.ts` and `components/ui/DemandBadge`;
  Decisions note that pricing uses `/releases/{id}` and labels with the settings currency), the spec's status line

- [ ] **Step 1: Live check.** Run `npm run lookup -- "BLP 1577" 1957 VG+ VG+ --id 5193282`. It prices with
  `lowestListing` 475-ish, and the CLI output (or a `--json` dump, if the CLI has one) shows have/want and
  `demand: "fast"`. If the CLI prints neither, add want/have and demand to its output. It's a dev tool, and it's the
  quickest live check.
- [ ] **Step 2: Docs** as listed.
- [ ] **Step 3: Run** `npm test && npm run typecheck`, and `npm run build` only if no dev server is running.
  Otherwise build in a scratch worktree.
- [ ] **Step 4: Commit** `docs: Phase 10 demand signal status`.

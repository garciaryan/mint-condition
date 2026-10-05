# Discogs CSV Export and Buy Sheet Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A lot downloads as a Discogs inventory-upload CSV (draft listings at the sell price) and opens as a printable buy sheet for the owner.

**Architecture:** Pure builders in `lib/collection/export.ts` (`toDiscogsCsv`, `exportCounts`, `csvFilename`,
`buySheetRows`). A GET route serves the CSV; the lot GET adds `exportCounts`; a server-rendered
`/collection/[id]/print` page renders the sheet with print CSS. No new dependencies.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, `node:sqlite`, Node's built-in test runner.

**Spec:** `docs/superpowers/specs/2026-10-04-export-print-design.md`

## Global Constraints

- No new dependencies. `lib/pricing.ts`, `lib/offer.ts` unchanged; prices come from `priceRecord` / `isPickRow` / `computeOffer`.
- CSV columns, in order: `release_id,price,media_condition,sleeve_condition,status,external_id,private_notes`; status `Draft`; external id `mc-<itemId>`; RFC 4180 quoting; CRLF; no BOM.
- Discogs grade wording exactly: `Mint (M)`, `Near Mint (NM or M-)`, `Very Good Plus (VG+)`, `Very Good (VG)`, `Good Plus (G+)`, `Good (G)`, `Fair (F)`, `Poor (P)`.
- Copy, verbatim: links "Export for Discogs", "Print buy sheet"; hint parts "<n> to export", "<n> still looking up", "<n> without a price" joined by " · ", or "Nothing to export yet"; sheet footer "Discogs asking prices and suggestions, not confirmed sales."; unverified line "Condition unverified (offers priced one grade lower)"; status labels "No match", "To pick", "No price", "Error", "Looking up".
- Every route starts with `requireSession`. Keep `npm test` and `npm run typecheck` green after every task.
- Single file: `node --experimental-strip-types --no-warnings --test tests/<file>.test.ts`

## Review Focus

1. A lot name starting with `=`, `+`, `-` or `@` lands in `private_notes`; opened in a spreadsheet it runs as a
   formula. Prefix such a value with a single space before quoting. (Task 1.)
2. `sell.floor` can be 0 in settings, giving a `0.00` price Discogs rejects: a row whose sell price is not > 0 is not
   exportable. (Task 1.)
3. A lot name with non-ASCII characters (é, emoji) must not reach the `Content-Disposition` header raw: the filename
   is the ASCII slug. (Tasks 1 and 3.)
4. Float noise in prices: `12.5` → `12.50`, `0.1 + 0.2` → `0.30` (format with `toFixed(2)` after the cents rounding
   `priceRecord` already does). (Task 1.)
5. A malformed lot id on the print page (`/collection/abc/print`) is a 404, not a 500. (Task 5, checked by hand.)

---

### Task 1: CSV builder, counts and filename

**Files:**
- Create: `lib/collection/export.ts`
- Test: `tests/collection-export.test.ts`

**Interfaces:**
- Consumes: `priceRecord` (`lib/pricing.ts`), `ItemRow` (`lib/collection/types.ts`), `Settings`, `Grade`.
- Produces: `DISCOGS_GRADE: Record<Grade, string>`; `toDiscogsCsv(lotName: string, items: ItemRow[], settings: Settings): string`;
  `exportCounts(items: ItemRow[], settings: Settings): { exportable: number; lookingUp: number; skipped: number }`;
  `csvFilename(lotName: string, lotId: number): string`. An internal `exportable(item, settings): { releaseId: number; price: number } | null` drives both the CSV and the counts.

- [ ] **Step 1: Write the failing tests** (use an `item()` helper like `tests/collection-view.test.ts`, with `refresh: false`, and `settings` parsed from `settings.json`)

```ts
const HEADER = "release_id,price,media_condition,sleeve_condition,status,external_id,private_notes";
const sugg = { NM: 40, "VG+": 30, VG: 20, "G+": 10 };
const priced = (o: Partial<ItemRow> = {}) => item({ status: "priced", releaseId: 101, suggestions: sugg, stats: null, ...o });

test("header and one row in Discogs wording at the sell price", () => {
  const it = priced({ id: 7, record: "VG+", sleeve: "VG" });
  const sell = priceRecord({ suggestions: sugg, lowestListing: null, record: "VG+", sleeve: "VG", settings })!.sell.price;
  assert.equal(toDiscogsCsv("Estate", [it], settings),
    `${HEADER}\r\n101,${sell.toFixed(2)},Very Good Plus (VG+),Very Good (VG),Draft,mc-7,Estate\r\n`);
});
test("every grade maps to Discogs wording", () => {
  assert.deepEqual(DISCOGS_GRADE, { M: "Mint (M)", NM: "Near Mint (NM or M-)", "VG+": "Very Good Plus (VG+)",
    VG: "Very Good (VG)", "G+": "Good Plus (G+)", G: "Good (G)", F: "Fair (F)", P: "Poor (P)" });
});
test("only priced rows with a release and a positive price are exported", () => {
  const rows = [
    priced({ id: 1 }),
    item({ id: 2, status: "no-match" }), item({ id: 3, status: "to-pick" }), item({ id: 4, status: "no-price", releaseId: 5 }),
    item({ id: 5, status: "error" }), item({ id: 6, status: "pending" }), item({ id: 8, status: "working" }),
    priced({ id: 9, releaseId: null }),
  ];
  const lines = toDiscogsCsv("L", rows, settings).trimEnd().split("\r\n");
  assert.equal(lines.length, 2);
  assert.match(lines[1], /,mc-1,/);
  const zeroFloor = { ...settings, sell: { undercutPercent: 100, floor: 0 } };
  assert.equal(toDiscogsCsv("L", [priced()], zeroFloor), `${HEADER}\r\n`);
});
test("lot names are quoted and formula-safe", () => {
  const csv = (name: string) => toDiscogsCsv(name, [priced({ id: 1 })], settings).split("\r\n")[1];
  assert.match(csv('Smith, "Jazz"'), /,"Smith, ""Jazz"""$/);
  assert.match(csv("two\nlines"), /,"two\nlines"$/);
  assert.match(csv("=SUM(A1)"), /, =SUM\(A1\)$/);
});
test("prices have exactly two decimals", () => { /* settings with floor 12.5 and undercut 100 → ",12.50," */ });
test("an empty lot is just the header", () => assert.equal(toDiscogsCsv("L", [], settings), `${HEADER}\r\n`));
test("exportCounts", () => {
  assert.deepEqual(exportCounts([priced(), priced(), item({ status: "pending" }), item({ status: "working" }), item({ status: "no-match" })], settings),
    { exportable: 2, lookingUp: 2, skipped: 1 });
});
test("csvFilename slugs the lot name and falls back to the id", () => {
  assert.equal(csvFilename("Estate Sale — Oct 4!", 3), "estate-sale-oct-4-discogs.csv");
  assert.equal(csvFilename("Café ☕", 3), "caf-discogs.csv");
  assert.equal(csvFilename("!!!", 3), "lot-3-discogs.csv");
  assert.equal(csvFilename("a".repeat(100), 3), `${"a".repeat(60)}-discogs.csv`);
});
```
Fill commented bodies with the assertion they name. (Unverified lots need no test: `toDiscogsCsv` never sees offer inputs, so listings always use the row's grades.)

- [ ] **Step 2: Run, expect FAIL** (module missing).
- [ ] **Step 3: Implement.** Quote a field when it contains `,` `"` `\r` or `\n`; formula guard first (leading `=`, `+`, `-`, `@` → prepend a space).
- [ ] **Step 4: Run `npm test`**, expect green.
- [ ] **Step 5: Commit** `feat(collection): Discogs inventory CSV builder`

---

### Task 2: Buy sheet rows

**Files:**
- Modify: `lib/collection/export.ts`
- Test: `tests/collection-export.test.ts`

**Interfaces:**
- Consumes: `isPickRow`, `OfferInputs` (`lib/offer.ts`), `marketFor` (`lib/collection/view.ts`).
- Produces: `BuySheetRow` (exact shape in the spec) and `buySheetRows(items: ItemRow[], settings: Settings, inputs: OfferInputs): BuySheetRow[]`.

- [ ] **Step 1: Write the failing tests**

```ts
test("buy sheet: picks first, then suggested value high to low, unpriced last in lot order", () => {
  const inputs = offerInputs({ unverified: false, pickThreshold: 25, bulkEach: null, lotOverhead: 0 }, settings);
  const rows = buySheetRows([
    item({ id: 1, status: "no-match" }),
    priced({ id: 2, record: "VG", sleeve: "VG" }),      // low value
    priced({ id: 3, record: "NM", sleeve: "NM" }),      // pick by threshold
    item({ id: 4, status: "to-pick" }),
    priced({ id: 5, record: "VG+", sleeve: "VG+" }),
  ], settings, inputs);
  assert.deepEqual(rows.map((r) => r.id), [3, 5, 2, 1, 4]);
  assert.deepEqual(rows.map((r) => r.statusLabel), [null, null, null, "No match", "To pick"]);
  assert.equal(rows[0].isPick, true);
});
test("buy sheet row fields", () => {
  /* priced row with release { title: "Blue", label: "Atlantic", year: 1971 } → title "Blue", detail "Atlantic · 1971",
     suggested = marketFor(...).suggested, sell = priceRecord(...).sell.price; release with no label/year → detail "";
     no release → title null; status labels for no-price "No price", error "Error", pending/working "Looking up" */
});
```

- [ ] **Step 2: Run, expect FAIL.** **Step 3: Implement** (stable sort; `marketFor` gives suggested at the row's grades). **Step 4: Run `npm test`**, expect green.
- [ ] **Step 5: Commit** `feat(collection): buy sheet rows`

---

### Task 3: CSV route and lot export counts

**Files:**
- Create: `app/api/sessions/[id]/discogs.csv/route.ts`
- Modify: `app/api/sessions/[id]/route.ts` (GET body gains `exportCounts: exportCounts(items, settings)`), `app/collection/[id]/api.ts` (`LotData.exportCounts`)
- Test: `tests/collection-routes.test.ts`

**Interfaces:**
- Consumes: Task 1; `parseId`, `errorJson`, `withSettings` (`lib/collection/http.ts`); `getSession`, `listItems`.
- Produces: `GET` handler with signature `(request: Request, { params }: { params: Promise<{ id: string }> })`.

- [ ] **Step 1: Write the failing tests** (import `GET as exportCsv` from the new route)

```ts
test("CSV export: auth, bad id, unknown lot", async () => {
  assert.equal((await exportCsv(req("GET", undefined, false), ctx("1"))).status, 401);
  assert.equal((await exportCsv(req("GET"), ctx("abc"))).status, 400);
  assert.equal((await exportCsv(req("GET"), ctx("999"))).status, 404);
});
test("CSV export downloads the lot as a Discogs file", async () => {
  const { body: lot } = await newLot({ name: "Café Sale", defaultRecord: "VG+", defaultSleeve: "VG" });
  /* add one item, poll until priced (as the existing "saved setting" test does) */
  const r = await exportCsv(req("GET"), ctx(String(lot.id)));
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("content-type"), "text/csv; charset=utf-8");
  assert.equal(r.headers.get("content-disposition"), 'attachment; filename="caf-sale-discogs.csv"');
  assert.equal(r.headers.get("cache-control"), "no-store");
  const text = await r.text();
  assert.ok(text.startsWith("release_id,price,"));
  assert.equal(text.trimEnd().split("\r\n").length, 2);
});
test("lot GET includes exportCounts", async () => { /* new lot → { exportable: 0, lookingUp: 0, skipped: 0 } */ });
```

- [ ] **Step 2: Run, expect FAIL.** **Step 3: Implement.** **Step 4: Run `npm test` and `npm run typecheck`**, expect green.
- [ ] **Step 5: Commit** `feat(api): Discogs CSV download and export counts`

---

### Task 4: Lot page links and hint

**Files:**
- Modify: `app/collection/[id]/LotHeader.tsx` (new props `exportCounts`), `app/collection/[id]/LotView.tsx` (pass it), `app/globals.css` (only if needed)

**Interfaces:**
- Consumes: `LotData.exportCounts` (Task 3).

- [ ] **Step 1: Implement.** In `.lot-actions`, before Delete: `<a className="button-link secondary" href={`/api/sessions/${id}/discogs.csv`} download>Export for Discogs</a>` (or, with 0 exportable, a `<span aria-disabled="true">` with the same look), and `<a href={`/collection/${id}/print`}>Print buy sheet</a>`. Below `.lot-actions`, a `<p className="meta muted small">` hint built by a pure `exportHint(counts): string` added to `lib/collection/export.ts` with its own test (`{2,1,3}` → "2 to export · 1 still looking up · 3 without a price"; `{0,0,0}` → "Nothing to export yet"; zero parts omitted). Links styled like the existing secondary buttons (44px tall).
- [ ] **Step 2: Test first for `exportHint`** (RED, then GREEN), then **run `npm run typecheck`, `npm test`, `npm run build`**, expect green.
- [ ] **Step 3: Commit** `feat(ui): export and print links on the lot page`

---

### Task 5: Buy sheet page

**Files:**
- Create: `app/collection/[id]/print/page.tsx` (server), `app/collection/[id]/print/PrintButton.tsx` (`"use client"`, calls `window.print()`)
- Modify: `app/globals.css` (print sheet styles and `@media print` rules)

**Interfaces:**
- Consumes: `buySheetRows` (Task 2), `computeOffer`, `offerInputs`, `oldestPricedAt`, `getSettings`, `getDb`, `getSession`, `listItems`, `parseId`, `relativeTime`, `SiteHeader`.

- [ ] **Step 1: Implement** to the spec's Buy sheet page section. `generateMetadata` gives "Buy sheet - <lot> - Mint Condition". `parseId` null or unknown lot → `notFound()`. `getSettings` throwing → render the message "settings.json is invalid: <reason>". Money via `Intl.NumberFormat` in the settings currency. Offer ladders: mark the opening rung ("opening") and over-max rungs ("over max"); walk-away below each. Table header cells: "", "Catalog no.", "Title", "Grades", "Suggested", "Sell", "★". `@media print`: hide `.topbar`, `.print-controls`; `body` white; `font-size: 10.5pt`; `thead { display: table-header-group }`; `tr { break-inside: avoid }`; `@page { margin: 12mm }`.
- [ ] **Step 2: Run `npm run typecheck`, `npm test`, `npm run build`**, expect green.
- [ ] **Step 3: Run `npm run dev` with a scratch `DATA_DIR`** and `curl` `/collection/1/print` (200 with the table markup after creating a lot via the API) and `/collection/abc/print` (404).
- [ ] **Step 4: Commit** `feat(ui): printable buy sheet`

---

### Task 6: Docs, staging, Discogs check, PR

**Files:** `CLAUDE.md`, `README.md`

- [ ] **Step 1: Docs.** `CLAUDE.md` Layout: `lib/collection/export.ts`, `app/collection/[id]/print/`, `app/api/sessions/[id]/discogs.csv/`; Status: "Phase 7 export and buy sheet (2026-10-04): built on feat/export-print; <N> tests passing; no migration; staging check pending"; Later phases: remove 7. README: an "Export and print" section under Collection mode (what the CSV contains, Draft status, upload at Discogs → Sell → Inventory upload, what's skipped; what the buy sheet shows and that it's for you, not the seller); Roadmap drops the CSV line.
- [ ] **Step 2: Run `npm test && npm run typecheck`**; commit `docs: export and buy sheet`.
- [ ] **Step 3: Ask the user before pushing**, then push the branch and fast-forward `staging`.
- [ ] **Step 4: Staging check with the user:** print preview at Letter on desktop and the page on a phone; download the CSV from a lot with two priced rows and upload it on Discogs as drafts. If Discogs rejects `Draft` or a column, fix the constant (test first), update the spec, redeploy staging, re-upload. Then delete the test drafts on Discogs.
- [ ] **Step 5: PR to `main`** (title "Phase 7: Discogs CSV export and buy sheet"), merge on the user's go-ahead, watch the prod deploy.

# Phase 7: Discogs CSV export and printable buy sheet

Date: 2026-10-04 · Status: approved design, awaiting spec review
Builds on: `docs/superpowers/specs/2026-10-04-collection-mode-design.md` (lots, rows),
`docs/superpowers/specs/2026-10-04-offer-calculator-design.md` (offers, picks)

## Why

After buying a lot, the owner lists the records on Discogs. Discogs takes a CSV inventory upload, so the lot should
export straight to that format instead of being re-keyed. Before or during a buy, the owner wants the lot on paper
for themselves: every record to tick off, with values, picks, the offer ladder and the walk-away.

Success:
- One link on a lot downloads a CSV that Discogs' inventory upload accepts, creating draft listings at the app's sell
  price with the row's grades.
- One link opens a printable buy sheet that fits Letter/A4, matches the lot page's numbers, and is for the owner's
  eyes (it shows walk-away and margins).

## Decisions (from brainstorming)

- **Buy sheet audience:** the owner only. Walk-away, ladder, picks and values are on it.
- **CSV purpose:** Discogs inventory upload (listing what was bought).
- **Rows exported:** every row with a pressing and a price at its grades. Others are skipped and counted.
- **Listing defaults:** status Draft (nothing goes live until reviewed); price = the app's sell price.
- **Approach:** CSV built server-side by a pure function behind a GET route; buy sheet is its own server-rendered
  page. No new dependencies.

## Non-goals

- Uploading to Discogs through the API (the owner uploads the file on Discogs).
- A seller-facing sheet, PDF generation, per-export column choices, picks-only export.
- Export of the single-record page.

## Discogs CSV

Discogs inventory upload: comma-separated, first row is a header of lower-case field names; required `release_id`,
`price`, `media_condition`. Exact spellings below come from Discogs' help article (not readable from this
environment). Confirmed by a real upload on staging (2026-10-04): the columns below, including `status` `Draft` and
`private_notes`, are accepted and create draft listings.

Columns, in order:

| Column | Value |
|---|---|
| `release_id` | the row's `releaseId` |
| `price` | sell price (`priceRecord(...).sell`) at the row's record/sleeve grades, 2 decimals, no symbol |
| `media_condition` | record grade in Discogs wording (table below) |
| `sleeve_condition` | sleeve grade in Discogs wording |
| `status` | `Draft` |
| `external_id` | `mc-<itemId>` |
| `private_notes` | the lot name |

Grade wording: M `Mint (M)` · NM `Near Mint (NM or M-)` · VG+ `Very Good Plus (VG+)` · VG `Very Good (VG)` ·
G+ `Good Plus (G+)` · G `Good (G)` · F `Fair (F)` · P `Poor (P)`.

Rows: included when `status === "priced"`, `releaseId !== null`, and `priceRecord` at the row's grades returns a
result. Everything else is skipped. One listing per row (duplicates stay separate). The lot's "condition
unverified" setting affects offers only, never the listing grades.

Format: RFC 4180 quoting (a field containing `,` `"` CR or LF is wrapped in quotes, inner quotes doubled), CRLF line
endings, UTF-8 without BOM. An empty export is just the header row.

If the staging upload shows Discogs wants `DRAFT` (or rejects a column), the constant changes before merge; the spec
is updated to match.

## Units

### `lib/collection/export.ts` (pure)

```ts
export const DISCOGS_GRADE: Record<Grade, string>;
export function toDiscogsCsv(lotName: string, items: ItemRow[], settings: Settings): string;
export function exportCounts(items: ItemRow[], settings: Settings): { exportable: number; lookingUp: number; skipped: number };
export function csvFilename(lotName: string, lotId: number): string;   // "estate-sale-oct-4-discogs.csv"
export function buySheetRows(items: ItemRow[], settings: Settings, inputs: OfferInputs): BuySheetRow[];
export type BuySheetRow = {
  id: number;
  query: string;
  title: string | null;            // release title, null when no pressing chosen
  detail: string;                  // "label · year" (parts that exist), "" when none
  record: Grade;
  sleeve: Grade;
  suggested: number | null;        // market suggested at the row's grades
  sell: number | null;
  isPick: boolean;
  statusLabel: string | null;      // null when priced; else "No match", "To pick", "No price", "Error", "Looking up"
};
```

- `exportCounts`: `exportable` = rows `toDiscogsCsv` would include; `lookingUp` = `pending` or `working`;
  `skipped` = the rest.
- `csvFilename`: lower-case, runs of anything other than `a-z0-9` become `-`, trimmed of `-`, cut to 60 chars; empty
  result falls back to `lot-<id>`; then `-discogs.csv`.
- `buySheetRows` order: picks first, then by `suggested` descending; rows without `suggested` last, in lot order.
  `isPick` uses the same rule as the lot page (`isPickRow`).

### `GET /api/sessions/[id]/discogs.csv` (`app/api/sessions/[id]/discogs.csv/route.ts`)

`requireSession`; bad id 400, unknown lot 404 (JSON, as the other lot routes); settings via `withSettings` (500
`kind: "settings"`). 200 body = `toDiscogsCsv(...)`, headers `Content-Type: text/csv; charset=utf-8`,
`Content-Disposition: attachment; filename="<csvFilename>"`, `Cache-Control: no-store`.

### Lot page links (`app/collection/[id]/LotHeader.tsx`)

In `.lot-actions`: an `<a>` "Export for Discogs" (`href` the CSV route, `download`) and a link "Print buy sheet"
(`/collection/<id>/print`). Under them a hint from the lot GET's `exportCounts` (below), e.g.
"18 to export · 2 still looking up · 3 without a price" (zero parts omitted). With 0 exportable the export link is
rendered as a disabled-looking `span` with `aria-disabled="true"` and the hint "Nothing to export yet".

The lot GET response gains `exportCounts` (computed server-side, where `ItemRow` and settings are at hand) so the
client doesn't recompute pricing.

### Buy sheet page (`app/collection/[id]/print/page.tsx`)

Server component, `dynamic = "force-dynamic"`, title "Buy sheet - <lot> - Mint Condition". Reads the lot with
`getDb()`, `getSettings`, `listItems`, `offerInputs`, `computeOffer`, `buySheetRows`, `oldestPricedAt`. Unknown or
malformed id → `notFound()`. Invalid `settings.json` → a short error message instead of the sheet.

Contents:
1. Header: lot name, printed date, record count, and "Condition unverified (offers priced one grade lower)" when on.
2. Offers: cherry-picks only and whole lot side by side, each with its ladder (opening rung marked, over-max rungs
   marked), walk-away; then picks / bulk / unpriced counts.
3. Table: ☐ · Catalog no. · Title · label · year · Grades (`VG+ / VG`) · Suggested · Sell · ★, in `buySheetRows`
   order; unpriced rows show their `statusLabel` in the value columns.
4. Footer: "Discogs asking prices and suggestions, not confirmed sales." and "Oldest prices: <age>" when older than
   an hour.

On screen: "Print" (`window.print()`, in a tiny client component) and "Back to lot" links. Print CSS: hide site
header and those controls; black on white, no backgrounds; 10–11pt; `thead { display: table-header-group }`;
`tr { break-inside: avoid }`; long titles wrap. On a phone the page reads as a normal page.

## Errors

| Case | Behaviour |
|---|---|
| Unknown lot | CSV 404 JSON; print page `notFound()`. |
| Nothing exportable | Export link disabled with "Nothing to export yet"; direct download gives the header only. |
| Rows looking up | Excluded; counted in the hint. |
| Signed out | Print page redirects to login (middleware); CSV route 401. |
| Invalid `settings.json` | CSV 500 `kind: "settings"`; print page shows the message. |

## Testing

- `toDiscogsCsv`: exact header; all 8 grade strings; price equals `priceRecord` sell at the row's grades, 2 decimals;
  each non-priced status skipped, and a priced row whose grade has no suggestion skipped; quoting of `,` `"` and
  newline in the lot name; CRLF; empty lot → header only; unverified lot still exports actual grades.
- `exportCounts`: exportable / lookingUp / skipped.
- `csvFilename`: slug rules and fallback.
- `buySheetRows`: order (picks, value desc, unpriced last in lot order), status labels, detail string, values.
- CSV route: 401, 400 bad id, 404, content type, disposition filename, body starts with the header.
- Lot GET includes `exportCounts`.
- Print page and links: by hand on staging (Letter preview, phone).

## Rollout

1. Branch `feat/export-print`.
2. Staging: print preview at Letter; download a CSV from a lot with two priced rows and upload it on Discogs as
   drafts to confirm the format (then delete the drafts).
3. PR to `main`.
4. Update `CLAUDE.md` (layout, Status: phase 7) and the README (export and print section; roadmap).

# Roadmap

Written 2026-10-07. These features come from looking at the app as a collector who also buys and sells collections
at popups and record fairs. Phases are in build order: each one lists what it needs from earlier phases. Every phase
gets its own design spec in `docs/superpowers/specs/` and its own branch before any code is written.

Today the app calls three Discogs endpoints: `/database/search`, `/marketplace/price_suggestions/{id}` and
`/marketplace/stats/{id}`. Most of the phases below use endpoints we don't call yet.

| Phase | Feature | Needs | Migration | New Discogs calls |
|---|---|---|---|---|
| 9 | Condition notes (**built 2026-10-07**, PR #29) | none | yes | none |
| 10 | Release details and demand signal (**built 2026-10-07**, PR #33) | none | yes | `/releases/{id}` (replaces stats) |
| 11 | Matching by runout in the picker | 10 | no | `/releases/{id}` per candidate, on demand |
| 12 | Versions of a master | 10 | no | `/masters/{id}/versions` |
| 13 | Boxes and bulk counts | none | yes | none |
| 14 | Linking my Discogs account: inventory and wantlist | none | yes | `/oauth/identity`, `/users/{u}/inventory`, `/users/{u}/wants` |
| 15 | Listing a collection on Discogs | 9, 14 | yes | `POST /marketplace/listings` |
| 8 | Price paid and sold price (already planned) | 15 | yes | `/marketplace/orders` |
| 16 | Scanning offline at fairs | none | no | none |

Phases 13 and 16 don't depend on anything else, so either can move up if a fair is coming. Phase 8 keeps its
original number but is built after 15, because matching orders to listings is what makes sold prices automatic.

## Rules that apply to every phase

- **Discogs API terms** (`lib/discogs-terms.ts`). Anything new from Discogs, including want/have counts, identifiers,
  versions, inventory and wantlist, is Discogs data:
  - Show none of it more than 6 hours old.
  - Store it with a fetched-at time so `hideExpired` / `requeueExpired` (or an equivalent) can cover it.
  - Put a "Data provided by Discogs" credit next to it and add a case to `tests/discogs-terms.test.ts`.
  - Price data is Restricted Data: nothing sold or passed to third parties.
- **No pricing for sales off Discogs.** No price stickers, no "popup price" mode. This was removed on 2026-10-05 and
  stays out (see CLAUDE.md).
- **Rate limit.** Every call goes through the shared throttled client (`lib/discogs-client.ts`, about 54 calls a
  minute). Each phase states its cost per record. Anything that fetches per candidate is on demand, never automatic.
- **Pure logic stays pure.** Thresholds and flags go in `lib/pricing.ts`, `lib/offer.ts` or a new pure module. New
  tunables go in `settings.json` with help text in `lib/settings-help.ts` (the help test enforces it).
- **Migrations** are appended to `lib/migrations.ts` (the next one is step 5). Test each against a local copy of the
  production database before merging (DEPLOY.md §9).

---

## Phase 9: Condition notes (built)

Built 2026-10-07 (PR #29): migration 5 (`items.notes`), the note editor on lot rows, the CSV `comments` column
and the buy sheet. Spec: `docs/superpowers/specs/2026-10-07-condition-notes-design.md`.

**Why.** A seam split, ring wear, a promo stamp, a hype sticker, an OBI or a sealed copy changes what a record is
worth and what goes in the listing. Right now none of it can be written down.

- Lot rows get an optional free-text note (`items.notes`, max 255 characters to fit Discogs listing comments).
- One-tap chips add common tags to the note: `sealed`, `hype sticker`, `promo`, `OBI`, `seam split`, `ring wear`,
  `writing`. The note stays plain text, so no tag schema.
- The Discogs CSV export (`lib/collection/export.ts`) puts the note in `comments`. The buy sheet shows it.
- The single-record lookup gets no notes, since nothing there is saved.
- The worker never writes `notes`. That matches the rule for grades and year.

**Done when** I can type a note on a row on my phone, it survives a re-price, and it shows up in the CSV and on the
buy sheet.

## Phase 10: Release details and demand signal (built)

Built 2026-10-07 (PR #33): `/releases/{id}` replaces marketplace stats (still two calls per record), migration 6
(`sessions.skip_slow`), fast/slow badge and want/have, "Leave slow sellers out of cherry-picks", Demand card on
`/settings`. Spec: `docs/superpowers/specs/2026-10-07-demand-signal-design.md`.

**Why.** A $30 suggestion with 1,800 for sale and few wants can sit for a year, while a want/have above 1 with four
for sale moves in a week. How fast a record sells decides what to cherry-pick.

- **Verify live first.** Check that `/releases/{id}?curr_abbr=<currency>` returns `lowest_price` and `num_for_sale`
  matching `/marketplace/stats`, plus `community.have`, `community.want`, `identifiers` and `master_id`. If it does,
  it **replaces** the stats call, so pricing still takes two calls per record. If it doesn't, it's added as a third
  call and the lot worker gets about 33% slower. Write down which one it was.
- Store `have`, `want`, `identifiers` and `masterId` with the row's lookup columns (migration). They share
  `priced_at`, so the existing expiry rules cover them.
- Search results already carry `community.have/want`. The picker shows them for each candidate at no extra cost.
- A pure `demand()` in a new `lib/demand.ts` returns `fast | normal | slow` from want/have and for-sale count.
  Thresholds go in settings (`demand.fastWantHave`, `demand.slowWantHave`, `demand.slowForSale`). Defaults are
  decision 1 below.
- UI: a small fast/slow badge on the result card and on lot rows, with the raw counts in a tooltip, and slow-mover
  totals in the totals bar.
- Offer: the automatic cherry-pick can leave out slow records (a lot-level toggle, off by default). Manual pins still
  win.

**Done when** each priced record shows want/have and a speed badge, the call count per record is written down, and
the pick toggle changes the offer.

## Phase 11: Matching by runout in the picker

**Why.** A catno and a year often match 20 pressings, and the first press can be worth 10x a repress. At the table
you identify a pressing by the dead wax, not the jacket.

- Each candidate in the picker (`app/Picker.tsx`, and `PickPanel` in lots) can expand to show its identifiers:
  Matrix/Runout, Pressing Plant, Rights Society and Label Code. Opening one fetches `/releases/{id}` through the
  cache. That's one call per opened candidate, never fetched in bulk on its own.
- A "Check runouts" button fetches identifiers for the pressings left after the year filter, capped at 25 (about 30
  seconds, with progress shown). Above the cap it tells me to narrow by year first.
- A "Runout contains…" box filters the candidates whose identifiers are loaded. Matching ignores case, spaces and
  dashes (`STERLING`, `A-1`, `-1A`), and the matched text is highlighted.
- The matching is pure and tested (`lib/form.ts` or `lib/runout.ts`).
- Picking a candidate reuses its fetched details, which feed Phase 10's columns.

**Done when** a catno with 20+ pressings can be narrowed to one by typing a matrix fragment, and the call count for
that flow is written down.

## Phase 12: Versions of a master

**Why.** To tell an original from a reissue, and to see where this copy sits among every pressing.

- From a priced release with a `master_id`, a "Versions" panel calls `/masters/{id}/versions` (paged, up to 3 pages
  like search). It lists year, country, label, catno and format, and marks this release and the earliest year
  listed.
- A pure flag compares this release's year to the earliest version and labels it "earliest listed year" or
  "reissue". The wording says "earliest listed on Discogs", not "original".
- Switching to another version re-prices it, the same as picking from the picker.

**Done when** the panel shows the versions, marks the current one, and can switch to another.

## Phase 13: Boxes and bulk counts

**Why.** A collection often comes as several boxes, and I make different offers on them ("box 2 is all disco"). Most
of a collection is commons I won't scan one by one.

- Collections get boxes (a `boxes` table, `items.box_id` nullable; no box = "Unsorted"). New items go into the
  current box, and rows can move between boxes.
- Each box has a bulk count: "+40 commons" at the lot's `bulkEach`, without scanning each one.
- `lib/offer.ts` works out the offer per box and in total (still pure). The totals bar and offer panel can show one
  box or all of them. The buy sheet groups by box.
- Existing lots move over as one "Unsorted" box with no change to their numbers (a test checks this).

**Done when** a lot with two boxes and a bulk count gives the same total as before when the boxes are merged, and
each box has its own offer.

## Phase 14: Linking my Discogs account (inventory and wantlist)

**Why.** As a dealer, the most useful warning at a fair is "you already have 3 of these listed". As a collector, it's
"this one's on your wantlist, keep it".

- Find the username from the token via `/oauth/identity` once, and store it.
- A background sync, run by the existing worker between lookups and never ahead of them, pages through
  `/users/{u}/inventory` (status For Sale and Draft) and `/users/{u}/wants`. It stores a release ID with a count or
  a want flag, plus a fetched-at time, and refreshes on use when older than 6 hours.
  Cost: one call per 100 listings or wants. A 5,000-listing store takes about a minute.
- Lot rows and the result card show "You have N listed" and "On your wantlist". Settings shows the last sync time
  and a "Sync now" button.
- Wantlist items are flagged but still count in the offer, margin and picks like any other record. A "Keep" toggle
  on the row (`items.keep`) takes it out of resale margin and picks and puts it in a separate "Keeping" total. Keep
  is never set automatically, and any row can be kept, not only wantlist items.

**Done when** scanning a record I already have listed, or one on my wantlist, flags it within one sync, and marking a
row Keep changes the margin math.

## Phase 15: Listing a collection on Discogs

**Why.** It replaces exporting a CSV and uploading it on discogs.com with one button.

- For picked rows in a lot, "Create drafts on Discogs" calls `POST /marketplace/listings` with `release_id`,
  `condition` and `sleeve_condition` (the Goldmine names in `GRADE_NAMES` already match), `price` (the sell price),
  `comments` (Phase 9 note) and `status: Draft`. Drafts only. I publish them on Discogs.
- Store `items.listing_id` (migration) so a second click never duplicates a listing. Rows that already have a listing
  show a link to it.
- Failures are reported per row and can be retried, the same way lookup errors are.
- The CSV export stays as the fallback.

**Done when** a lot creates drafts on Discogs once, a second click does nothing, and the drafts match the buy sheet.

## Phase 8: Price paid and sold price (already planned)

**Why.** It turns guesses into a measured offer percentage. The user has no rule of thumb, and the ladder starts at
40%.

- Price paid per lot, spread across items by market value (pure, tested) or entered per item.
- Sold prices come from `/marketplace/orders` matched to `items.listing_id` (Phase 15), with manual entry for
  anything sold another way.
- A report shows what I actually got as a percentage of what I paid and of market value, overall and per lot. It can
  suggest a new `openingPercent` but never changes it on its own.
- Sold prices are my own sales, so they are kept indefinitely. The 6-hour limit doesn't apply to them (decided
  2026-10-07). Anything else from the order response that is Discogs catalogue data, such as titles or images, is
  not stored. The report shows the release from the lot row.

## Phase 16: Scanning offline at fairs

**Why.** Fairs happen in warehouses and church basements with no signal. Right now a dead connection means a dead
scanner.

- Make the app installable (manifest and a service worker), and precache the app shell plus the lazy
  `barcode-detector` chunk and its WASM.
- When offline, the lot scanner and paste list save scans to IndexedDB with the lot ID, grades, year and note. The
  page shows "N queued, will price when online". When the connection returns, they are sent as normal adds and the
  worker prices them.
- Offline means **no prices**. Showing prices offline would need stored Discogs data, which can be more than 6 hours
  old. The app says this plainly.
- Session expiry: if the login cookie has expired by the time the connection returns, the queue waits through the
  login and then sends.
- Test on iOS Safari as an installed app and on Android Chrome.

**Done when** I can scan 20 records in airplane mode, turn the network back on, and see all 20 priced in the lot.

---

## Decisions (2026-10-07)

1. Demand thresholds (Phase 10) start at: fast when want/have ≥ 1 and ≤ 10 for sale; slow when want/have < 0.3 or
   ≥ 200 for sale. These are the `settings.json` defaults, tuned later on real lots.
2. Runout cap (Phase 11): 25 candidates.
3. Wantlist (Phase 14): wantlist items count in the offer like anything else unless the row is marked Keep.
4. Sold prices (Phase 8): kept indefinitely; they are the user's own sales.

# Phase 4: Collection mode

Date: 2026-10-04 · Status: approved design, awaiting spec review
Builds on: `docs/superpowers/specs/2026-10-04-go-online-design.md` (hosting, login, `lib/db.ts` migrations)

## Why

When evaluating a collection to buy, the owner needs to enter many records quickly and end up with a lot total they
trust. They use it on-site with a phone, on-site with a laptop, and at a desk, often starting on one device and
finishing on another. The lot total feeds the Phase 5 offer calculator.

Success:
- Records can be added by typing, by a USB scanner, by the phone camera, or by pasting a list, without the flow ever
  stopping for a question.
- Ambiguous records wait in a "to pick" queue that can be cleared later, on any device.
- Totals show the low / suggested / high market value with honest coverage ("62 of 70 priced").
- Lookups keep going with the phone locked or the tab closed, and nothing is lost if the machine sleeps.

## Decisions (from brainstorming)

- **Ambiguity:** never interrupt entry. A record matching several pressings becomes *to pick*, keeps its saved match
  list, and is resolved whenever the owner chooses.
- **Totals:** market value only (low / suggested / high), plus coverage counts. Sell, local and net-after-fees totals
  are out of scope.
- **Entry methods:** quick add (type + Enter, works with USB scanners), bulk paste, and phone camera scanning.
- **Queue:** runs on the server, one in-process worker. The Fly machine may sleep (auto-stop stays on); pending work
  resumes on wake.
- **Dependency:** add `barcode-detector` (npm), lazy-loaded only when Scan is opened. It uses the native
  `BarcodeDetector` where available and its WASM fallback elsewhere (iPhone Safari). This is the project's first
  runtime dependency beyond Next/React.

## 1. Data model

Migration 1 in `lib/migrations.ts` creates:

```sql
CREATE TABLE sessions (
  id              INTEGER PRIMARY KEY,
  name            TEXT    NOT NULL,
  default_record  TEXT    NOT NULL,
  default_sleeve  TEXT    NOT NULL,
  created_at      INTEGER NOT NULL,   -- ms epoch
  updated_at      INTEGER NOT NULL
);
CREATE TABLE items (
  id               INTEGER PRIMARY KEY,
  session_id       INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  query            TEXT    NOT NULL,  -- catno or barcode as entered (trimmed, <= 64 chars)
  year             INTEGER,           -- optional search year
  record_grade     TEXT    NOT NULL,
  sleeve_grade     TEXT    NOT NULL,
  status           TEXT    NOT NULL CHECK (status IN ('pending','working','to-pick','priced','no-match','no-price','error')),
  release_id       INTEGER,
  release_json     TEXT,              -- Candidate of the chosen pressing
  candidates_json  TEXT,              -- Candidate[] when several matched
  suggestions_json TEXT,              -- PriceSuggestions (all grades)
  stats_json       TEXT,              -- MarketplaceStats
  priced_at        INTEGER,
  error            TEXT,              -- short message for status 'error'
  created_at       INTEGER NOT NULL
);
CREATE INDEX items_session ON items(session_id, created_at);
CREATE INDEX items_status  ON items(status, created_at);
```

- **One row per physical copy.** Duplicates are separate rows.
- **Grades:** each row stores its own grades. The entry bar starts at the lot's defaults and keeps the last-used
  grades between adds. Changing a lot's defaults affects only rows added later.
- **Session name:** defaults to `Lot <Mon D>` (e.g. "Lot Oct 4"), max 80 chars.
- **Prices are calculated when read, never stored.** For each row with `suggestions_json`, run the existing
  `priceRecord({ suggestions, lowestListing: stats.lowestPrice, record, sleeve, settings })` and use `market.low`,
  `market.suggested` and `market.high`. Grade changes and `settings.json` changes are reflected immediately, with no
  Discogs calls.

**Row states.** `working` is internal and is shown as "Looking up".

| From | Event | To |
|---|---|---|
| pending (no release) | search returns 0 | no-match |
| pending (no release) | search returns >1 | to-pick, with `candidates_json` saved |
| pending (no release) | search returns 1 | release set, then priced |
| pending (release set) | suggestions plus stats fetched | priced |
| pending (release set) | no suggestions, or none for the row's grade | no-price |
| to-pick | owner picks a release from `candidates_json` | pending (release set) |
| pending | Discogs error other than 429/401 | error, with message |
| error / no-match | Retry | pending |
| priced / no-price | Re-price all | pending (release set); old suggestions kept until replaced |

**Totals.**
- low, suggested and high are summed over rows whose stored suggestions give a market value for the row's grade.
  This includes rows being re-priced, which keep their old values.
- Coverage counts: `total`, `priced`, `toPick`, `noPrice` (no-price plus priced rows with no value for their
  grade), `problems` (no-match plus error), `pending` (pending plus working).

## 2. Lookup worker

- **Shared Discogs client:** move the client getter out of `app/api/lookup/route.ts` into `lib/discogs-client.ts`
  (`getDiscogsClient()`, a `globalThis` singleton). `/api/lookup` and the worker share one throttle.
- **`lib/collection/worker.ts`**
  - `processItem(client: LookupClient, item): ItemPatch` is pure apart from the injected client, and follows the
    state table above. It reuses `searchByCatno` (catno or barcode, year filter) and
    `priceSuggestions` + `marketplaceStats`.
  - `kickWorker()` starts the loop if it's idle. The loop picks the oldest `pending` row across all sessions, sets it
    to `working`, runs `processItem`, writes the patch, bumps the session's `updated_at`, and repeats until nothing
    is pending.
  - Exactly one loop per process, guarded by a module-level flag on `globalThis`.
- **Starting the loop:** adding rows, picking a pressing, Retry and Re-price all each call `kickWorker()`.
- **Startup:** `instrumentation.ts` `register()`, on the Node runtime only, resets `working` rows to `pending` and
  calls `kickWorker()`. This covers restarts and wake from auto-stop.
- **Errors:**
  - 429: already retried inside `DiscogsClient`.
  - Any other `DiscogsError` or network error: the row becomes `error` with a short message, and the loop continues.
  - 401: the row becomes `error` ("Discogs rejected the token"), and the queue is **paused** by a `globalThis` flag.
    The loop stops. Retry on any row clears the pause and kicks the loop.
- **Queue state** for the API: `{ pending: number, paused: boolean, etaSeconds: number }`, where
  `etaSeconds = pending × 3 × 1.1`. That's three requests per row at the client's 1.1 s spacing; to-pick rows don't
  count.

## 3. API

Every route is behind the existing gate. Each also verifies the session itself through a shared helper
`requireSession(request)` in `lib/route-auth.ts`, extracted from `/api/lookup`'s check, which then uses it too.
Errors use the existing `{ status: "error", kind, message }` shape. Request bodies are capped at 64 KB
(Content-Length check), except bulk paste, which is capped at 128 KB.

| Method and path | Body | Returns |
|---|---|---|
| `GET /api/sessions` | | `[{ id, name, updatedAt, itemCount, suggested }]`, newest first |
| `POST /api/sessions` | `{ name?, defaultRecord, defaultSleeve }` | session |
| `GET /api/sessions/:id` | | `{ session, items: ItemView[], totals, queue }` |
| `PATCH /api/sessions/:id` | `{ name?, defaultRecord?, defaultSleeve? }` | session |
| `DELETE /api/sessions/:id` | | `{ ok: true }` (rows cascade) |
| `POST /api/sessions/:id/items` | `{ lines: [{ query, year? }], record, sleeve }`, 1–500 lines | `{ added: ItemView[] }` |
| `PATCH /api/items/:id` | `{ record?, sleeve?, year?, releaseId? }` | `ItemView` |
| `DELETE /api/items/:id` | | `{ ok: true }` |
| `POST /api/items/:id/retry` | | `ItemView` (only from error / no-match) |
| `POST /api/sessions/:id/reprice` | | `{ queued: number }` |

**Field notes.**
- `ItemView`: id, query, year, grades, status (`working` mapped to `"looking-up"`), release (Candidate or null),
  candidateCount, market (`{ low, suggested, high }` or null), stats, pricedAt, error. Full candidates are returned
  only by `GET /api/items/:id/candidates`, which the picker uses so session polls stay small.
- **Grades:** validated with `isGrade`. **Year:** null or an integer from 1890 to 2100 (the existing rule).
  **Query:** trimmed, 1–64 chars.
- **`releaseId`:** must exist in that row's `candidates_json`, otherwise 400. Setting it clears `candidates_json`,
  sets `release_json`, sets status `pending` and kicks the worker.
- **Deleting a row:** removes it. Undo in the UI re-adds it through `POST …/items` with the same query, year and
  grades. It is looked up again; the chosen pressing is not restored.

**Bulk paste parser:** `parseBulkLines(text): { lines: { query, year? }[], errors: { line: number, reason }[] }` in
`lib/collection/parse.ts`, pure.
- Split on newlines, trim, skip blank lines.
- If a line contains a comma or tab, the text after the **last** comma or tab is the year when it's a valid year.
  An invalid year makes that line an error. The text before it is the query.
- A trailing year after a plain space is never split off, so `ST 2001` stays a query.
- Queries over 64 chars are errors.
- More than 500 valid lines: only the first 500 are kept, with an error noting the cap.

## 4. Screens

Plain CSS reusing the existing tokens and accessibility rules (labels, 44px controls on phones, 16px inputs, focus
moves, `aria-live` status). The approved mockup is described here; the ui-ux-pro-max checklist is applied during
implementation.

**Navigation:** the header gets **Price a record** (`/`) and **Lots** (`/collection`), with the current page
marked, beside Log out.

**`/collection`**
- A **New lot** form: name prefilled with "Lot Oct 4", default record and sleeve grades, and a **Create** button
  that opens the new lot.
- The list of lots: name, updated date, item count, suggested total.

**`/collection/[id]`**
- **Header:** the name (tap to rename), defaults, **Re-price all**, **Delete lot** (confirm dialog).
- **Totals bar** (sticky):
  - Low / Suggested / High in tabular figures
  - coverage line: "62 of 70 priced · 4 to pick · 2 no price · 1 error"
  - queue line: "Looking up · 41 left · ~2 min", with a spinner that respects reduced motion
  - an "Offline, retrying" line when polling fails
  - a token-paused banner with Retry
- **Entry bar**
  - Fields: catalog number or barcode (focused on load), Year, Record, Sleeve, **Add**, **Scan**, and a
    **Paste a list** toggle.
  - **Enter** in the query or year field adds the row, clears both fields and keeps focus in the query field.
  - Grades persist between adds.
  - A failed add keeps the typed text and shows an inline error.
- **Paste a list:** a textarea with a live preview from `parseBulkLines` ("23 records, 1 line skipped: line 4"),
  and an **Add 23 records** button.
- **Scan** (camera, full screen)
  - The header shows the current grades and a **Done** button.
  - Each read vibrates (`navigator.vibrate`, where supported), adds the row, shows "Added … · keep scanning", and
    lists this scan session's codes with their live status.
  - The same code read within 3 s is ignored, to avoid double adds.
  - If permission is denied, it explains how to allow it and offers typing. With no camera or a failed library load,
    the Scan button is hidden.
- **Filters:** All · To pick (n) · Problems (n).
- **Rows**
  - Content: thumbnail, title, label · catno · country · year · format (or the query and year before a pressing is
    known), Record and Sleeve dropdowns, market suggested with low–high beneath (dimmed while re-pricing), and a
    status label with an icon and text.
  - Actions depend on the state: Pick pressing / Retry / Remove.
  - Remove shows an **Undo** bar for 6 s.
- **Pick pressing:** opens the existing `Picker` component in a panel (a side panel on desktop, a bottom sheet on
  phones) with Escape/✕ to close. Choosing a pressing closes it and moves focus to the next to-pick row.
- **Polling:** `GET /api/sessions/:id` every 2 s while `queue.pending > 0` or a request is in flight, and every 15 s
  otherwise while the tab is visible. Polling pauses when the tab is hidden.
- **Phones** (up to 480px):
  - Rows become cards.
  - The totals bar shows Suggested and "62/70" and expands on tap.
  - Entry fields are full width, with Scan and Add side by side.
- **Auth:** a 401 from any call redirects to `/login?next=/collection/<id>`.

## 5. Errors, testing, rollout

**Error states:**
- Offline or failed polls: the "Offline, retrying" line, with retry every 5 s.
- Unknown lot: a "Lot not found" page with a link to Lots.
- Invalid input: 400 with a message, shown next to the relevant field.
- Discogs failures: shown on the row.

**Tests** (`npm test`; typecheck and build stay green, and CI runs them before each deploy):
- `tests/collection-parse.test.ts`:
  - comma and tab years
  - `ST 2001` not split
  - the last comma wins (`Smith, John, 1971`)
  - invalid years reported with line numbers
  - blank lines
  - the 500 cap
  - the 64-char cap
- `tests/collection-pricing.test.ts`:
  - row market value from stored suggestions
  - grade changes alter the value
  - coverage counts per status
  - to-pick and no-match rows excluded from totals
  - rows being re-priced keep their old values
- `tests/collection-worker.test.ts`, with a fake `LookupClient` and an in-memory DB:
  - no match, several matches, one match then priced
  - no price data, and a grade missing from the suggestions
  - a 502 makes the row an error
  - a 401 pauses the queue and Retry resumes it
  - restart resets `working` rows
  - strict one-at-a-time processing, oldest first
- `tests/collection-routes.test.ts`, calling route handlers against an in-memory DB:
  - create, list, get, rename, delete (cascade)
  - add lines, pick a valid release, reject a release not in the candidates
  - retry, re-price
  - session required on every route
  - validation errors are 400
- `tests/db.test.ts`: migration 1 creates both tables and indexes, and ON DELETE CASCADE works.

**Rollout:**
- Feature branch, then a PR. Merging to `main` deploys via the GitHub workflow, and migration 1 runs at startup.
- Post-deploy: `/api/health` returns 200, and a smoke run creates a lot through the API.
- Phone check on mobile data: create a lot, add 5 records (typed, scanned, pasted), pick one pressing, and confirm
  the totals.
- Update CLAUDE.md (layout, status) and the README (collection mode section).

## Out of scope

Offers (Phase 5); a shared price cache and settings UI (Phase 6); CSV export and print sheet (Phase 7); editing a
row's query after adding it (remove and re-add); sell, local and net totals; multi-user sharing.

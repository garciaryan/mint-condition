# Mint Condition

Local, single-user web app (Next.js App Router + TypeScript) that prices vinyl records using the Discogs API.
Input: catalog number, pressing year, record grade, sleeve grade (optionally an area code). Output: fair market
value range, sell price, and local-sale price. Later phases add collection (bulk buying) tools.

## Decisions already made
- Runs on localhost only; no deploy, no auth, no OAuth. Discogs access uses a **personal access token** from the
  user's seller account (needed for `/marketplace/price_suggestions`). Token lives in `.env.local`, server-side only.
- Never expose `DISCOGS_TOKEN` to the browser. All Discogs calls go through Next route handlers or server actions.
- Discogs requires a descriptive `User-Agent` (`DISCOGS_USER_AGENT`).
- Keep `lib/pricing.ts` and `lib/offer.ts` as **pure functions** (no network, no fs, no DB). All tunables come from
  `settings.json`.
- Price meanings: *market value* = Discogs suggestion for the record grade x sleeve multiplier (range = next grade
  down to next grade up). *Sell price* = market x (1 - undercut), floored. *Local price* = market x local discount x
  area-code multiplier, shown next to what the user would net on Discogs after fees.
- Discogs data is asking prices and suggestions, not confirmed sales. The UI should say so.

## Commands
- `npm install`
- `npm test` (Node's built-in test runner, no extra deps; Node 22.6+)
- `npm run typecheck`
- `npm run lookup -- "<catno|barcode>" <year> <recordGrade> <sleeveGrade> [areaCode] [--id <releaseId>]` (CLI check)
- `npm run dev` -> http://localhost:3000

## Layout
- `lib/types.ts` grades and shared types · `lib/settings.ts` settings loader/validator
- `lib/discogs.ts` API client (throttled, retries 429, catno variants, barcode detection, year filter)
- `lib/pricing.ts` pricing logic · `lib/lookup.ts` lookup flow for the API route · `lib/form.ts` client-side
  form checks and picker grouping · `tests/` unit tests
- `scripts/lookup.ts` CLI · `app/` Next.js UI (`api/lookup/route.ts`, `Lookup.tsx`, `globals.css`)

## Status
- Phase 1 (Discogs client) and phase 2 (pricing module): done. Verified against the live API (2026-10-04):
  price_suggestions keys and marketplace stats fields match. Search now pages (100/page, up to 3 pages) and sorts
  exact year, then nearby, then unknown year; popular catnos return 100+ pressings, many with no year.
- Phase 3 (webpage): built. `lib/lookup.ts` (request parsing, search-or-price, error mapping; tested),
  `app/api/lookup/route.ts` (POST; shared throttled client on globalThis), `app/Lookup.tsx` (form, picker, result
  card). Grade changes re-fetch prices for the shown release. 43 tests passing.
- Phase 3 UX pass (2026-10-04, ui-ux-pro-max review): responsive down to 375px, a11y fixes (3:1 field borders,
  labelled filter, focus moves to new results, status live region, `role="alert"` errors), in-place re-pricing
  (old result dimmed, no layout jump; area code changes re-price too), retry on rate-limit/upstream errors,
  inline field errors. `lib/form.ts` holds client-safe pure logic (field checks, picker grouping). 49 tests passing.
- Barcode input (2026-10-04): the catno field also takes a UPC/EAN (8/12/13/14 digits, spaces/dashes ok, valid
  check digit). Searched via Discogs `barcode=` first, then falls back to catno variants. Verified live: Discogs
  normalises spacing and UPC-A vs EAN-13 itself. Shared barcodes often return bootlegs ("Unofficial Release" in
  format). 55 tests passing.

## Phase 3 spec
1. Single page at `/` with a form: catalog number (text), year (number), record grade and sleeve grade (dropdowns
   with Goldmine names, M/NM/VG+/VG/G+/G/F/P), area code (optional text), "Local sale" toggle.
2. Server action or `/api/lookup` route calling `DiscogsClient`; if several pressings match, return candidates and
   show a picker (cover thumb, title, label, country, year, format). One match -> go straight to pricing.
   Picking a pressing then fetches prices for that release id.
3. Result card: market value (low / suggested / high), sell price (with the "above cheapest listing" note), local
   price with region multiplier and "net on Discogs after fee", copies for sale, lowest listing, link to
   `https://www.discogs.com/release/<id>`, and a short note that these are asking prices not sales.
4. Handle states: loading, no match, no price data (grade missing or seller setup issue), 401 bad token,
   rate-limited, missing env vars (show a clear setup message, never the token). Every error gives a recovery path
   (retry button for rate-limited/upstream). Re-pricing keeps the previous result visible (dimmed, `aria-busy`).
5. Keep styling simple and clean (plain CSS or CSS modules is fine; Tailwind optional). Responsive: works from
   375px phones to desktop (16px inputs, 44px controls, stacked price blocks on narrow screens).
6. Accessibility: visible label on every field (inline errors via `aria-describedby`), control borders >= 3:1,
   text >= 4.5:1, focus moves to the new heading after search/pick/back, results announced via a status region.
7. Add tests for any new pure logic; keep `npm test` and `npm run typecheck` green.

## Later phases (do not start unless asked)
4. Collection mode: sessions, keyboard-first batch entry, bulk paste of catalog numbers, lot-wide default grades,
   running totals. 5. Offer calculator: offer ladder (30/40/50/60%), overhead, margin, cherry-pick vs bulk split,
   unverified-condition discount (downgrade grades for remote buys). 6. SQLite cache + settings UI (24h cache).
7. CSV export, printable buy sheet. 8. Track price paid and sold price to learn the user's own offer percentage.
   The user has no offer-percentage rule of thumb; default ladder starts at 40%.

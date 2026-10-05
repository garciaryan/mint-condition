# Mint Condition

Single-user web app (Next.js App Router + TypeScript), hosted on Fly.io, that prices vinyl records using the Discogs API.
Input: catalog number, pressing year, record grade, sleeve grade (optionally an area code). Output: fair market
value range, sell price, and local-sale price. Later phases add collection (bulk buying) tools.

## Decisions already made
- Hosted on Fly.io (one machine, SQLite on a volume at `/data`), single-password login (`APP_PASSWORD_HASH` +
  `SESSION_SECRET`), no OAuth. Discogs access uses a **personal access token** from the user's seller account
  (needed for `/marketplace/price_suggestions`), stored as a Fly secret (`.env.local` for local dev). With neither
  APP_* var set outside production, login is off; only one set = misconfigured (503). Never run more than one machine.
- Every push to `main` deploys: `.github/workflows/fly-deploy.yml` runs test, typecheck and build, then
  `flyctl deploy --remote-only` (`FLY_API_TOKEN` repo secret, deploy-scoped, expires 2027-10-04). Keep `main` green.
- Staging is a separate Fly app `mint-condition-staging` (`fly.staging.toml`, own volume `mint_staging_data`, own
  secrets and DB, one machine). Every push to branch `staging` deploys it via `.github/workflows/fly-deploy-staging.yml`
  (`FLY_API_TOKEN_STAGING` repo secret). Test migrations there before prod.
- Never expose `DISCOGS_TOKEN` to the browser. All Discogs calls go through Next route handlers or server actions.
- Discogs requires a descriptive `User-Agent` (`DISCOGS_USER_AGENT`).
- Keep `lib/pricing.ts` and `lib/offer.ts` as **pure functions** (no network, no fs, no DB). All tunables come from
  `settings.json`, overridden by the saved row edited on `/settings` (`lib/settings-store.ts`); routes read settings
  through `getSettings(getDb())`. Currency and region multipliers come only from the file.
- Price meanings: *market value* = Discogs suggestion for the record grade x sleeve multiplier (range = next grade
  down to next grade up). *Sell price* = market x (1 - undercut), floored. *Local price* = market x local discount x
  area-code multiplier, shown next to what the user would net on Discogs after fees.
- Collection mode: lot prices are computed at read time (`lib/collection/view.ts`) from stored per-grade Discogs
  suggestions and stats, so grade changes cost no API call. One in-process lookup worker (`lib/collection/worker.ts`,
  started by `instrumentation.ts`) drains pending items through the shared client in `lib/discogs-client.ts`, so one
  throttle covers lookups and the worker. The worker writes only lookup columns, never grades, year or query.
- Discogs answers (search, price suggestions, stats) are cached in SQLite (`discogs_cache`, `lib/discogs-cache.ts`)
  for `discogs.cacheHours` (0 = off). Callers use `getLookupClient()`, which wraps the shared throttled client.
  Lot Re-price and Retry (`items.refresh`) and the single-record "Refresh prices" bypass it; errors are never
  cached. Row `priced_at` is when Discogs answered, so cached prices show their real age.
- `barcode-detector` is the only runtime dependency beyond Next/React; it is lazy-loaded by the camera scanner.
- Discogs data is asking prices and suggestions, not confirmed sales. The UI should say so.

## Commands
- `npm install`
- `npm test` (Node's built-in test runner, no extra deps; Node 22.13+)
- `npm run typecheck`
- `npm run lookup -- "<catno|barcode>" <year> <recordGrade> <sleeveGrade> [areaCode] [--id <releaseId>]` (CLI check)
- `npm run dev` -> http://localhost:3000
- `npm run hash-password` (interactive; prints `APP_PASSWORD_HASH`) · deploy and ops: see `DEPLOY.md`

## Layout
- `lib/types.ts` grades and shared types · `lib/settings.ts` settings loader/validator
- `lib/discogs.ts` API client (throttled, retries 429, catno variants, barcode detection, year filter)
- `lib/pricing.ts` pricing logic · `lib/offer.ts` offer ladder/walk-away/picks (pure) · `lib/lookup.ts` lookup flow for the API route · `lib/form.ts` client-side
  form checks and picker grouping · `tests/` unit tests
- `scripts/lookup.ts` CLI · `app/` Next.js UI (`api/lookup/route.ts`, `Lookup.tsx`, `globals.css`)
- `lib/auth.ts` (session signing, authMode, limiter, health config) · `lib/password.ts` (hashing) · `lib/gate.ts` +
  `middleware.ts` (login gate) · `lib/db.ts` + `lib/migrations.ts` (SQLite, versioned migrations)
- `app/login/`, `app/api/login|logout|health` · `scripts/hash-password.ts` · `Dockerfile`, `docker-entrypoint.sh`,
  `fly.toml`, `fly.staging.toml`, `DEPLOY.md`, `.github/workflows/fly-deploy.yml`, `fly-deploy-staging.yml`

- `lib/settings-store.ts` (saved settings over defaults) · `lib/settings-form.ts` (form conversion, client-safe) ·
  `app/settings/` (`SettingsForm`) · `app/api/settings/`
- `lib/collection/` (`types`, `store` SQLite, `parse` paste parser, `view` totals/prices, `ui`, `http`, `worker`) ·
  `lib/discogs-client.ts` shared client + `getLookupClient()` · `lib/discogs-cache.ts` response cache ·
  `lib/relative-time.ts` · `lib/route-auth.ts` per-route session check · `instrumentation.ts`
- `lib/collection/export.ts` (Discogs CSV, buy sheet rows) · `app/collection/[id]/print/` (buy sheet) ·
  `app/api/sessions/[id]/discogs.csv/`
- `app/collection/` (lots list) and `app/collection/[id]/` (`LotView`, `EntryBar`, `Scanner`, `PasteList`,
  `PickPanel`, `TotalsBar`, `OfferPanel`, `ItemRow`) · `app/api/sessions/` and `app/api/items/` · shared `app/Picker.tsx`,
  `app/GradeSelect.tsx`, `app/SiteHeader.tsx`, `app/NavLinks.tsx`

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
- Go online (2026-10-04): deployed to https://mint-condition.fly.dev (app `mint-condition`, region `sjc`, one
  machine, volume `mint_data`). Remote image build OK; smoke checks pass (health 200, `/` → login, API 401 without
  cookie, foreign Origin 403). Phone check on mobile data passed (log in, price a record).
- Phase 4 collection mode (2026-10-04): merged and deployed; checked on prod.
  Spec: `docs/superpowers/specs/2026-10-04-collection-mode-design.md`.
- Phase 5 offer calculator (2026-10-04): merged and deployed (migration 2: lot offer inputs, row `pick`); checked on
  prod. Spec: `docs/superpowers/specs/2026-10-04-offer-calculator-design.md`.
- Phase 6a settings UI (2026-10-04): built on feat/settings-ui; 221 tests passing; migration 3 (`settings` table);
  checked on staging, merged to main. Spec: `docs/superpowers/specs/2026-10-04-settings-ui-design.md`.
- Phase 6b Discogs cache (2026-10-04): built on feat/discogs-cache; 253 tests passing; migration 4 (`discogs_cache`,
  `items.refresh`); checked on staging, merged to main. Spec: `docs/superpowers/specs/2026-10-04-discogs-cache-design.md`.
- Phase 7 export and buy sheet (2026-10-04): built on feat/export-print; 267 tests passing; no migration; checked on
  staging (Discogs draft upload accepted: `Draft`, `private_notes`), merged to main. Spec: `docs/superpowers/specs/2026-10-04-export-print-design.md`.

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
8. Track price paid and sold price to learn the user's own offer percentage.
   The user has no offer-percentage rule of thumb; default ladder starts at 40%.

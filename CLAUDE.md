# Mint Condition

Single-user web app (Next.js App Router + TypeScript), hosted on Fly.io, that prices vinyl records using the Discogs API.
Input: catalog number (or barcode), pressing year, record grade, sleeve grade. Output: fair market value range and
sell price (with the net after the Discogs fee). Collection (bulk buying) tools build on it.

## Decisions already made
- Hosted on Fly.io (one machine, SQLite on a volume at `/data`; it suspends when idle rather than stopping, since a
  cold boot showed a blank page for ~4.5 s, 2026-10-07), single-password login, no OAuth. The password is
  `APP_PASSWORD` (plain, min 12) or `APP_PASSWORD_HASH` (scrypt), never both. `SESSION_SECRET` comes from the env or,
  when unset, `DATA_DIR/session-secret`, made once at boot by `lib/session-secret.ts` (`instrumentation.ts`); env
  wins. `npm run setup:fly` sets the Fly secrets via `fly secrets import` on stdin (2026-10-05). Discogs access uses a
  **personal access token** from the user's seller account (needed for `/marketplace/price_suggestions`), stored as a
  Fly secret (`.env.local` for local dev). With no password outside production, login is off; in production, or with
  a bad combination, misconfigured (503 with the reason). Never run more than one machine.
- Every push to `main` deploys: `.github/workflows/fly-deploy.yml` runs test, typecheck and build, then builds one
  image to `ghcr.io/garciaryan/mint-condition:<tag>`, deploys it to the canary (this app, `FLY_API_TOKEN` repo secret,
  deploy-scoped, expires 2027-10-04), tags the release, and deploys the same image to each shop app in the repo
  variable `FLY_SHOP_APPS` (`[{app, token}]`, checked by `lib/shops.ts`; one Fly org and deploy-token secret per shop;
  DEPLOY.md §10, 2026-10-07). Keep `main` green.
- Versions (2026-10-07): alpha. Each successful deploy is tagged `v<package.json version>-alpha.N` (N from 1 per base,
  `scripts/next-version.ts` + `lib/version.ts`) with a GitHub pre-release (`--generate-notes`); the tag is the
  `APP_VERSION` build arg → `NEXT_PUBLIC_APP_VERSION`, shown by `/api/health` and at the foot of `/settings` ("dev"
  locally). Bump the base (`0.2.0`) in a PR to start a new line; keep `package.json` `version` plain `x.y.z`.
- No staging app (retired 2026-10-05; older status lines below mention it). Test migrations against a local copy of
  the production database (`DATA_DIR=data/prod-copy npm run dev`, DEPLOY.md §9) before merging to `main`.
- Never expose `DISCOGS_TOKEN` to the browser. All Discogs calls go through Next route handlers or server actions.
- Discogs requires a descriptive `User-Agent` (`DISCOGS_USER_AGENT`).
- Keep `lib/pricing.ts` and `lib/offer.ts` as **pure functions** (no network, no fs, no DB). All tunables come from
  `settings.json`, overridden by the saved row edited on `/settings` (`lib/settings-store.ts`); routes read settings
  through `getSettings(getDb())`. Currency comes only from the file.
- Price meanings: *market value* = Discogs suggestion for the record grade x sleeve multiplier (range = next grade
  down to next grade up). *Sell price* = market x (1 - undercut), floored, with *net* = sell x (1 - Discogs fee).
  Local-sale pricing was removed (2026-10-05): pricing records for sale off Discogs with Discogs data is close to the
  terms' "circumvent Our marketplace" example. Don't bring it back. The fee is `sell.discogsFeePercent`; rows saved
  with the old `local.discogsFeePercent` are read through `moveLegacyFee` in `lib/settings-store.ts`.
- Naming: the UI says *collection(s)* (renamed from "lot" 2026-10-05); code, CSS, settings keys (`lotOverhead`) and
  the DB (`sessions`) still say lot/session. Use "collection" in anything user-visible.
- Collection mode: lot prices are computed at read time (`lib/collection/view.ts`) from stored per-grade Discogs
  suggestions and stats, so grade changes cost no API call. One in-process lookup worker (`lib/collection/worker.ts`,
  started by `instrumentation.ts`) drains pending items through the shared client in `lib/discogs-client.ts`, so one
  throttle covers lookups and the worker. The worker writes only lookup columns, never grades, year or query.
- Discogs answers (search, price suggestions, stats) are cached in SQLite (`discogs_cache`, `lib/discogs-cache.ts`)
  for `discogs.cacheHours` (0 = off, max 6). Callers use `getLookupClient()`, which wraps the shared throttled client.
  Lot Re-price and Retry (`items.refresh`) and the single-record "Refresh prices" bypass it; errors are never
  cached. Row `priced_at` is when Discogs answered, so cached prices show their real age.
- `barcode-detector` is the only runtime dependency beyond Next/React; it is lazy-loaded by the camera scanners.
  Camera loop: `hooks/useBarcodeCamera.ts` (lot `Scanner` keeps scanning; `components/lookup/LookupScanner.tsx` is one-shot).
  `components/scan/ScanButton.tsx` is the barcode icon; when `lib/camera.ts` says no camera (plain http, none), pressing it
  explains why instead of hiding. The lookup form clears catno/year once a pressing is shown (`clearsInputs`).
- Font: Kanit (400/500/600/700, latin) via `next/font/google` in `app/layout.tsx`, self-hosted at build time.
  Kanit has proportional digits and no `tnum`, so every `font-variant-numeric: tabular-nums` rule also sets
  `font-family: var(--font-numeric)` (system font); `tests/font.test.ts` checks it. Only use the loaded weights.
- Discogs data is asking prices and suggestions, not confirmed sales. The UI should say so.
- Pricing calls `/marketplace/price_suggestions/{id}` and `/releases/{id}` (not `/marketplace/stats`, since Phase 10):
  two calls per record. The release gives copies for sale, lowest listing (a bare number in the account's currency,
  so prices are labelled with `settings.discogs.currency`), want/have, master and identifiers, kept in `stats_json`.
  Demand (`lib/demand.ts`): fast = want/have ≥ 1 and ≤ 10 for sale, slow = want/have < 0.3 or ≥ 200 for sale
  (`settings.json` `demand`, editable); shown as `components/ui/DemandBadge` only next to the Discogs credit.
- Discogs API terms (`lib/discogs-terms.ts`): no Discogs data shown more than 6 hours old (`MAX_CACHE_HOURS`; lot
  rows past it are hidden by `hideExpired` and re-queued by `requeueExpired` when the lot or buy sheet opens);
  "Data provided by Discogs" linked next to the data (no `nofollow`): the release on the result card and lot rows,
  `components/ui/DiscogsCredit.tsx` (Discogs search for pick lists, marketplace for totals, offers, the lots list and scanner);
  `discogs.com/release/<id>` per buy-sheet row; the result card hides its figures past 6 hours (`dataExpired`);
  the not-affiliated notice in `components/layout/SiteFooter.tsx` on every page. Anything new that shows Discogs data needs a credit
  (`tests/discogs-terms.test.ts`). Price data is Restricted Data: no commercial use, no transfer to third parties.

- Released as self-hosted, MIT-licensed (`LICENSE`): each person runs their own copy (locally or their own Fly app)
  with their own Discogs token and IP rate limit; there is no shared public instance. The workflow runs the checks on PRs
  and pushes to `main`; the deploy job only runs on pushes to `main` of `garciaryan/mint-condition`. Once public,
  ruleset "Protect main": PR required (0 approvals), "Test and build" must pass, no force-push or deletion; admin
  (the owner) can bypass. Never commit
  secrets; the repo is public.

## Commands
- `npm install`
- `npm test` (Node's built-in test runner, no extra deps; Node 22.13+)
- `npm run typecheck`
- `npm run lookup -- "<catno|barcode>" <year> <recordGrade> <sleeveGrade> [--id <releaseId>]` (CLI check)
- `npm run dev` -> http://localhost:3000
- `npm run setup:fly` (interactive; sets the Fly secrets) · `npm run hash-password` (optional; prints
  `APP_PASSWORD_HASH`) · deploy and ops: see `DEPLOY.md`

## Layout
Folders (`tests/structure.test.ts` keeps them this way; spec `docs/superpowers/specs/2026-10-07-folder-structure-design.md`):
`app/` routes only (`page.tsx`, `layout.tsx`, `route.ts`, `globals.css`) · `components/<area>/` · `hooks/` ·
`lib/` (logic; relative imports, no UI, loadable by the Node tests) · `lib/consts.ts` (`LINKS` repo/docs/coffee,
`ROUTES` page paths; cookie names stay in auth/theme/nav, Discogs URLs in `discogs-terms.ts`). UI files import with
`@/...`; `lib/` and `app/api/` stay relative.

- **Routes:** `app/page.tsx` (price a record) · `app/collection/` (lots list), `app/collection/[id]/` (lot),
  `app/collection/[id]/print/` (buy sheet) · `app/settings/` · `app/login/` · `app/api/` (`lookup`, `login|logout|health`,
  `settings`, `sessions/` incl. `[id]/discogs.csv`, `items/`, `releases/[id]/identifiers`, `masters/[id]/versions`)
- **`components/layout/`:** `SiteHeader` (server: reads `mc_theme`/`mc_nav`) + `SiteNav` (fixed left sidebar, expanded
  by default, collapses to an icon rail remembered by `mc_nav` via `lib/nav.ts`; a bottom tab bar at 480px and below;
  Docs and the coffee pill sit at its foot, the footer shows them only on phones and pages without the sidebar) ·
  `NavLinks` (expanded desktop sidebar lists the 3 most recent collections under Collections, then "+N more";
  `navLots`) · `NavIcon` (inline SVG icons) · `SiteFooter` (not-affiliated notice) · `ThemeSwitch` (cycles
  System/Light/Dark) · `LogoutButton` (on `/settings`, Account card, only when login is on)
- **`components/lookup/`:** `Lookup` (form, picker, result card) · `LookupScanner` · `Picker` · `VersionsPanel`
- **`components/scan/`:** `ScanButton`, `ScanFrame` · **`components/ui/`:** `GradeSelect`, `DiscogsCredit`, `DemandBadge`
- **`components/collection/`:** `LotsList`, `LotView`, `LotHeader`, `EntryBar`, `Scanner`, `PasteList`, `PickPanel`,
  `TotalsBar`, `OfferPanel`, `ItemRow`, `PrintButton`
- **`components/settings/`:** `SettingsForm`, `HelpTip` (ⓘ toggle) · **`components/login/`:** `LoginForm`
- **`hooks/`:** `useBarcodeCamera` (camera loop), `useDisclosure` (+ `lib/disclosure.ts`: lot Actions, help tips),
  `useFadeOut`, `useDialog`
- **`lib/`:** `types.ts` grades and shared types · `settings.ts` loader/validator · `discogs.ts` API client (throttled,
  retries 429, catno variants, barcode detection, year filter) · `pricing.ts` · `offer.ts` (ladder/walk-away/picks,
  pure) · `lookup.ts` lookup flow for the API route · `form.ts` client-side form checks and picker grouping ·
  `auth.ts` (session signing, authMode, limiter, health config) · `password.ts` · `gate.ts` + `middleware.ts` (login
  gate) · `db.ts` + `migrations.ts` (SQLite, versioned) · `setup-fly.ts` (pure) · `session-secret.ts` ·
  `demand.ts` (fast/slow from want/have, pure) · `runout.ts` (runout matching and highlight, pure) · `versions.ts` (master versions: sort, earliest, filter; pure) ·
  `settings-store.ts` (saved settings over defaults) ·
  `settings-form.ts` (client-safe) · `settings-help.ts` (every
  field has help, tested; the sleeve grid shares one `SLEEVE_HELP`) · `discogs-client.ts` shared client +
  `getLookupClient()` · `discogs-cache.ts` · `relative-time.ts` · `discogs-terms.ts` · `theme.ts` · `nav.ts` ·
  `camera.ts` · `route-auth.ts` per-route session check · `version.ts` (deploy tags, app version) · `shops.ts` (`FLY_SHOP_APPS` check)
- **`lib/collection/`:** `types`, `store` (SQLite), `parse` (paste parser), `notes` (condition notes), `view`
  (totals/prices), `ui`, `http`, `worker`, `export` (Discogs CSV, buy sheet rows), `client` (browser fetch helper,
  `money`)
- **Other:** `tests/` · `scripts/lookup.ts` CLI, `scripts/hash-password.ts`, `scripts/setup-fly.ts` + `scripts/prompt.ts`, `scripts/next-version.ts` (deploy tag), `scripts/shop-apps.ts`
  · `instrumentation.ts` · `Dockerfile`, `docker-entrypoint.sh`, `fly.toml`, `DEPLOY.md`,
  `.github/workflows/fly-deploy.yml`

## Status
- Phase 1 (Discogs client) and phase 2 (pricing module): done. Verified against the live API (2026-10-04):
  price_suggestions keys and marketplace stats fields match. Search now pages (100/page, up to 3 pages) and sorts
  exact year, then nearby, then unknown year; popular catnos return 100+ pressings, many with no year.
- Phase 3 (webpage): built. `lib/lookup.ts` (request parsing, search-or-price, error mapping; tested),
  `app/api/lookup/route.ts` (POST; shared throttled client on globalThis), `components/lookup/Lookup.tsx` (form, picker, result
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
  staging (Discogs draft upload accepted: `Draft`, `private_notes`), merged to main.
- Dark mode (2026-10-04): 281 tests passing; checked on staging, merged to main. Colours are tokens on `:root` in
  `app/globals.css` with a dark palette (device setting, or pinned via cookie `mc_theme` read in `app/layout.tsx`);
  `tests/theme-contrast.test.ts` checks contrast in both themes. Never hard-code a colour outside the token blocks. Palette (2026-10-05): parchment/deep-space blue
  pages, deep-space-blue/parchment text, strong cyan `--fill` buttons with deep-space-blue labels in both themes,
  darker cyan `--accent` for links in light (cyan fails 4.5:1 on parchment). Docs and Buy Me a Coffee
  are plain links (no BMC widget script), in the sidebar on wider screens and the footer on phones; `body` is a flex column so the footer sits at the bottom. Motion uses the
  `--dur-fast`/`--dur`/`--ease` tokens (`--t-interactive` for hover/focus); menus, dialogs and the pick drawer
  animate in only, and `prefers-reduced-motion` turns all of it off (`tests/motion.test.ts`). Spec: `docs/superpowers/specs/2026-10-04-export-print-design.md`.
- Phase 9 condition notes (2026-10-07): built on feat/condition-notes; 360 tests passing; migration 5 (`items.notes`,
  '' = none). One public note per lot row (listing text for buyers), edited under the row ("Note" button, tag chips
  from `lib/collection/notes.ts`, max 255), saved via `PATCH /api/items/:id`; the worker never writes it and lookups
  keep it. Goes to the Discogs CSV `comments` column and the buy sheet; `private_notes` stays the collection name.
  Spec: `docs/superpowers/specs/2026-10-07-condition-notes-design.md`.
- Phase 10 demand signal (2026-10-07): built on feat/demand-signal; 413 tests passing; migration 6
  (`sessions.skip_slow`). `/releases/{id}` replaces marketplace stats (live check in the spec). Fast/slow badge and
  want/have on the result card and lot rows, "N slow" in the totals, "Leave slow sellers out of cherry-picks" per collection
  (cherry-pick offer only; the whole-collection offer still values them as picks)
  (stars still win), Demand card on `/settings`. Spec: `docs/superpowers/specs/2026-10-07-demand-signal-design.md`.
- Phase 11 runout matching (2026-10-07): built on feat/runout-match; 433 tests passing; no migration. The shared
  `Picker` (lookup and lot Pick panel) loads a pressing's identifiers on demand from `GET /api/releases/:id/identifiers`
  (cached `release:<id>`), "Check runouts" for up to 25 showing pressings, and "Runout contains…" filters by a
  letters+digits fragment across all identifiers, highlighted (`lib/runout.ts`). Picking a checked pressing prices
  with one call. Spec: `docs/superpowers/specs/2026-10-07-runout-match-design.md`.

- Phase 12 master versions (2026-10-07): built on feat/master-versions; 456 tests passing; no migration. A "Vinyl
  versions" panel on the result card (only when the release has a master) loads `GET /api/masters/:id/versions` on
  first open (`format=Vinyl`, oldest first, up to 3 pages, cached `versions:<id>`), marks "This copy" and "Earliest
  listed" (20 a page, opening on this copy's page), says "reissue" or "earliest year listed on Discogs" (never
  "original"), and picking a version re-prices it. Credit links `discogs.com/master/<id>`. Spec: `docs/superpowers/specs/2026-10-07-master-versions-design.md`.
- Multi-app deploy (2026-10-07): built on feat/multi-app-deploy; 484 tests passing; no app or DB change beyond
  `setup:fly --app`. Build once to GHCR, canary, release, then shops from `FLY_SHOP_APPS`. Spec:
  `docs/superpowers/specs/2026-10-07-multi-app-deploy-design.md`. Next: Connect Discogs (OAuth) so shops never paste
  a token.

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
Full plan, build order and terms rules: `docs/ROADMAP.md` (2026-10-07). Phases 9–16: condition notes, release
details + demand signal, runout matching, master versions, boxes + bulk counts, account inventory/wantlist, listing
drafts on Discogs, offline scanning.
8. Track price paid and sold price to learn the user's own offer percentage (built after 15; sold prices from orders).
   The user has no offer-percentage rule of thumb; default ladder starts at 40%.

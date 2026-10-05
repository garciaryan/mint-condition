# Mint Condition

Price a vinyl record from its catalog number (or barcode) and condition, using Discogs marketplace data.

Enter a catalog number, the pressing year, and the record and sleeve grades. Mint Condition finds the matching
pressing on Discogs and gives you three numbers:

- **Market value**: a low / suggested / high range for your copy's condition.
- **Sell price**: what to list it for on Discogs to undercut comparable copies.
- **Local price**: what to ask in person, next to what you'd actually net on Discogs after fees.

> Discogs figures are asking prices and price suggestions, not confirmed sales. Treat them as a guide.

## Hosted version

The app runs at **https://mint-condition.fly.dev** behind a single password, so it works from a phone on-site.
Log in once and the session lasts 30 days; **Log out** is in the page header. After 5 wrong passwords from the same
connection, logins pause for 15 minutes.

Every push to `main` is tested and then deployed automatically. Setup, secrets, changing the password, logs and
backups are covered in [DEPLOY.md](DEPLOY.md).

## Requirements

- Node.js 22.13 or newer
- A Discogs **seller** account and a personal access token from
  [discogs.com/settings/developers](https://www.discogs.com/settings/developers). Price suggestions are only
  returned for seller accounts with their seller settings (including a payment method) completed.

## Setup

```sh
npm install
cp .env.example .env.local
```

Fill in `.env.local`:

| Variable | What it is |
|---|---|
| `DISCOGS_TOKEN` | Your personal access token. It stays on the server and is never sent to the browser. |
| `DISCOGS_USER_AGENT` | A descriptive User-Agent, which Discogs requires, e.g. `VinylPricer/0.1 (+you@example.com)`. |

Then start the app:

```sh
npm run dev
```

and open http://localhost:3000. Locally there's no login unless you set `APP_PASSWORD_HASH` and `SESSION_SECRET`
in `.env.local` too (see [DEPLOY.md](DEPLOY.md)).

## Using it

1. **Catalog number or barcode.** Type the catno from the label or spine (`SD 7208`, `SD7208` and `SD-7208` all
   work), or a UPC/EAN barcode. A USB barcode scanner works too: it types the digits and presses Enter.
2. **Pressing year** (optional). Narrows the search to pressings within a year of it.
3. **Record grade and sleeve grade**, on the Goldmine scale: M, NM, VG+, VG, G+, G, F, P.
4. **Local sale** (optional). Turn it on to see a local asking price; add an area code to apply a regional
   multiplier.

If several pressings match, you'll get a list grouped by year with cover thumbnails, label, country and format.
Pick the one that matches your copy. Changing a grade afterwards re-prices the same pressing straight away.

The result card shows the three prices, how many copies are for sale on Discogs, the lowest current listing, and a
link to the release on Discogs.

## Collection mode

Price a whole lot at **/collection** (**Lots** in the header). Lots are saved on the server, so you can start one on
a phone and finish it on a laptop.

1. **Create a lot.** Name it and set the default record and sleeve grades; new records start with those.
2. **Add records**, any of three ways:
   - **Quick add**: type a catalog number or barcode and press Enter. A USB scanner works the same way.
   - **Scan**: the phone camera reads barcodes and keeps scanning. Barcodes are mostly on records from the 1980s
     on, so older ones need typing.
   - **Paste a list**: one record per line, with an optional year after a comma or tab (`SD 7208, 1971`). Up to
     500 lines; bad lines are reported and the rest are added.
3. **Let it work.** A background worker looks each record up on Discogs, one at a time at the Discogs rate limit.
   It keeps going with the phone locked or the page closed (while lookups are queued the server keeps itself
   awake); if the server was asleep, it resumes as soon as the app is opened. Rows show their state (Queued, Looking up, To pick, Priced, No match, No price data, or Error with a Retry button).
4. **To pick.** A record that matches several pressings waits in the "To pick" queue. Open it, choose the
   pressing, and it's priced. The rest of the lot isn't held up.
5. **Totals.** The bar shows low / suggested / high market value for the lot plus coverage, for example
   "62 of 70 priced · 4 to pick …", so you can see how much of the total is still missing.
6. **Grades and re-pricing.** Changing a record's grades re-prices it instantly from the stored Discogs
   suggestions, with no new request. **Re-price all** fetches fresh figures from Discogs for the whole lot.

Totals use the same market value as the single lookup. Like everything here they are asking prices and
suggestions, not sales.

### Offers

Open **Offer** on a lot to see what to offer the seller. It shows two deals side by side:

- **Cherry-picks**: only the valuable records. A record is a pick when its suggested value is at or above the lot's
  **pick threshold** (default $15). Tap the star on a row to add or remove it by hand.
- **Whole lot**: the picks plus everything else at a flat **bulk** price per record (default $0.50). Records that
  aren't priced yet (to pick, no match, no price) count as bulk, and the panel says how many.

Each deal has a **ladder** (30 / 40 / 50 / 60% of the picks' suggested value, opening at 40%) and a **walk-away**:
the most you can pay and still keep your margin. Walk-away = what the picks would net on Discogs after the fee ×
(1 − margin) − overhead per pick − the lot's overhead (gas, travel), never below $0. Bulk is counted at cost. Rungs
above the walk-away are marked "over max". Offers are whole dollars, rounded down.

For a remote buy from photos, switch on **Condition unverified**: every record is priced one grade lower (record
and sleeve) for the offer only.

The pick threshold, bulk price and lot overhead are set per lot. The ladder, margin (30%), overhead per record
($1.50) and unverified steps are in the `offer` block of `settings.json`.

## How prices are worked out

- **Market value**: the Discogs price suggestion for your record grade, multiplied by a sleeve-condition
  multiplier. The range runs from the next grade down to the next grade up.
- **Sell price**: market value minus an undercut percentage, never below a floor. It's flagged when it comes out
  above the cheapest current listing, since that copy may be in worse shape.
- **Local price**: market value × a local discount × the area-code multiplier. Shown next to what selling on
  Discogs would net after the seller fee.

Every number above comes from [`settings.json`](settings.json). Edit it to change the sleeve multipliers, the
undercut and floor, the Discogs fee, the local discount, regional multipliers by area code, the currency, and the
offer ladder, margin and defaults.

## Command-line lookup

Check a price without the web UI:

```sh
npm run lookup -- "SD 7208" 1971 VG+ VG+
npm run lookup -- "0 720642 442517" 2015 NM VG+ 212
npm run lookup -- "SD 7208" 1971 VG+ VG+ --id 1234567   # price a specific release id
```

When several pressings match, it lists them with their release ids so you can re-run with `--id`.

## Development

```sh
npm test               # unit tests (Node's built-in test runner, no extra dependencies)
npm run typecheck      # TypeScript, no emit
npm run hash-password  # make an APP_PASSWORD_HASH for the login (interactive)
```

```
app/                   Next.js App Router UI
  page.tsx             page shell
  Lookup.tsx           form, pressing picker, result card
  Picker.tsx, GradeSelect.tsx  shared by the lookup page and lots
  SiteHeader.tsx, NavLinks.tsx header and nav
  collection/          /collection lots list; [id]/ is one lot (entry bar, camera scanner, paste, to-pick
                       panel, totals, offer panel, rows)
  login/               login page
  api/lookup/route.ts  POST /api/lookup: Discogs lookups for the single-record page (lots use the worker)
  api/sessions/        lots: list/create, one lot, add items (bulk), re-price all
  api/items/[id]/      edit, retry, candidates (to-pick)
  api/login, logout    session cookie in and out
  api/health           public health check (database + which config is set)
middleware.ts          runs the login gate on every request
instrumentation.ts     starts the lookup worker when the server boots
lib/
  discogs.ts           Discogs client: throttled, retries on 429, catno variants, barcode detection
  pricing.ts           pricing logic (pure functions)
  offer.ts             offer ladder, walk-away, cherry-pick vs bulk (pure functions)
  discogs-client.ts    one shared Discogs client per process (one throttle for lookups and the worker)
  route-auth.ts        per-route session check
  collection/          lots: types, store (SQLite), parse (paste), view (pure totals/prices), ui, worker
  lookup.ts            request validation, search-or-price flow, error mapping
  form.ts              client-side form checks and picker grouping
  auth.ts, password.ts session cookies, login limiter, password hashing
  gate.ts              decides who gets through (pure function)
  db.ts, migrations.ts SQLite on the Fly volume, versioned migrations
  settings.ts          settings.json loader and validator
  types.ts             grades and shared types
scripts/               command-line lookup, password hashing
tests/                 unit tests
settings.json          pricing tunables
Dockerfile, fly.toml   Fly.io deployment
```

## Roadmap

- Price cache and a settings page
- CSV export and a printable buy sheet
- Tracking what you paid and sold for, to learn your own offer percentage

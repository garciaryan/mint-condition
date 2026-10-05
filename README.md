# Mint Condition

Price a vinyl record from its catalog number (or barcode) and condition, using Discogs marketplace data.

Enter a catalog number, the pressing year, and the record and sleeve grades. Mint Condition finds the matching
pressing on Discogs and gives you three numbers:

- **Market value**: a low / suggested / high range for your copy's condition.
- **Sell price**: what to list it for on Discogs to undercut comparable copies.
- **Local price**: what to ask in person, next to what you'd actually net on Discogs after fees.

For buying collections, **collection mode** prices a whole lot of records at once and works out what to offer the
seller: an opening offer, a ladder to negotiate up, and the most you can pay and still make your margin.

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
7. **Make an offer.** Open **Offer** to see what to pay for the cherry-picks or the whole lot (see below).

Totals use the same market value as the single lookup. Like everything here they are asking prices and
suggestions, not sales.

### Offers

Open **Offer** on a lot to see what to offer the seller. It shows two deals side by side:

- **Cherry-picks**: only the valuable records. A record is a pick when its suggested value is at or above the lot's
  **pick threshold** (default $15). Tap the star on a row to add or remove it by hand.
- **Whole lot**: the picks plus everything else at a flat **bulk** price per record (default $0.50). Records that
  aren't priced yet (to pick, no match, no price) count as bulk, and the panel says how many.

Each deal has a **ladder** (30 / 40 / 50 / 60% of the picks' suggested value, opening at 40%) and a **walk-away**:
the most you can pay and still keep your margin:

- **Cherry-picks walk-away** = what the picks would net on Discogs after the fee × (1 − margin) − overhead per pick
  − the lot's overhead (gas, travel), never below $0.
- **Whole-lot walk-away** = the same amount plus the bulk at cost, never below $0. If the lot's overhead is more
  than the picks cover, the whole-lot walk-away comes down by the difference.

"You keep" on each rung is how far that offer is below the walk-away, so it's room to negotiate on top of your
margin, not your profit. Rungs above the walk-away are marked "over max". Offers are whole dollars, rounded down.

For a remote buy from photos, switch on **Condition unverified**: every record is priced one grade lower (record
and sleeve) for the offer only.

The pick threshold, bulk price and lot overhead are set per lot. The ladder, margin (30%), overhead per record
($1.50) and unverified steps are on the [Settings](#settings) page.

### Export and print

- **Export for Discogs** downloads the lot as a Discogs inventory-upload CSV. Upload it on Discogs (Sell Music →
  Inventory Upload). Each priced record becomes a **draft** listing at the app's sell price with its record and
  sleeve grades, so nothing goes live until you review it there. Records with no pressing or no price are left out;
  the line under the link says how many will export.
- **Print buy sheet** opens a printer-friendly page for you (not the seller): both offer ladders with the walk-away,
  then every record with a box to tick, its grades, suggested and sell value, and a ★ for picks. Picks and the
  most valuable records come first.

## How prices are worked out

- **Market value**: the Discogs price suggestion for your record grade, multiplied by a sleeve-condition
  multiplier. The range runs from the next grade down to the next grade up.
- **Sell price**: market value minus an undercut percentage, never below a floor. It's flagged when it comes out
  above the cheapest current listing, since that copy may be in worse shape.
- **Local price**: market value × a local discount × the area-code multiplier. Shown next to what selling on
  Discogs would net after the seller fee.
- **Offers** (lots only): the ladder is a percentage of the cherry-picks' suggested value, plus the flat bulk price
  for everything else. The walk-away starts from what the picks would net at the sell price after the Discogs fee.
  It then takes off your margin and overhead, and adds the bulk at cost. Details are under
  [Offers](#offers).

Discogs answers are reused for up to 24 hours (set on the [Settings](#settings) page), so re-grading a record or
opening it again is instant. When prices come from that cache the card says how old they are, with **Refresh
prices** to fetch them fresh; a lot's **Re-price all** and **Retry** always fetch fresh, and a lot shows how old its
oldest prices are.

Every number above can be changed on the [Settings](#settings) page.

## Settings

**Settings** in the nav edits the sleeve multipliers, the undercut and minimum sell price, the local price and
Discogs fee, the default area multiplier, and the offer ladder, opening offer, margin, overhead, pick threshold,
bulk price and unverified steps, and how many hours Discogs answers are cached (0 turns the cache off).
Multipliers are shown as percentages (a VG sleeve keeps 85% of market value).

- A save applies straight away to new lookups and to every lot, including lots you already made offers on.
- Each changed field shows its default; **Reset to defaults** goes back to [`settings.json`](settings.json).
- Saved values live in the database and win over `settings.json`. A setting added to the file later still gets
  its default.
- The currency follows your Discogs seller account and isn't editable. Regional multipliers by area code are
  still set in `settings.json` only.

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
  settings/            /settings page (SettingsForm)
  api/lookup/route.ts  POST /api/lookup: Discogs lookups for the single-record page (lots use the worker)
  api/sessions/        lots: list/create, one lot, add items (bulk), re-price all
  api/items/[id]/      edit, retry, candidates (to-pick)
  api/settings/        GET/PUT/DELETE saved settings
  api/login, logout    session cookie in and out
  api/health           public health check (database + which config is set)
middleware.ts          runs the login gate on every request
instrumentation.ts     starts the lookup worker when the server boots
lib/
  discogs.ts           Discogs client: throttled, retries on 429, catno variants, barcode detection
  pricing.ts           pricing logic (pure functions)
  offer.ts             offer ladder, walk-away, cherry-pick vs bulk (pure functions)
  discogs-client.ts    one shared Discogs client per process (one throttle for lookups and the worker)
  discogs-cache.ts     SQLite cache of Discogs answers in front of that client
  collection/export.ts Discogs inventory CSV and buy sheet rows (pure functions)
  relative-time.ts     "3 hours ago" formatting
  route-auth.ts        per-route session check
  collection/          lots: types, store (SQLite), parse (paste), view (pure totals/prices), ui, worker
  lookup.ts            request validation, search-or-price flow, error mapping
  form.ts              client-side form checks and picker grouping
  auth.ts, password.ts session cookies, login limiter, password hashing
  gate.ts              decides who gets through (pure function)
  db.ts, migrations.ts SQLite on the Fly volume, versioned migrations
  settings.ts          settings.json loader, validator, merge of saved values over defaults
  settings-store.ts    saved settings (one SQLite row) over the settings.json defaults
  settings-form.ts     settings page form: percent conversion and field checks (client-safe)
  types.ts             grades and shared types
scripts/               command-line lookup, password hashing
tests/                 unit tests
settings.json          pricing tunable defaults
Dockerfile, fly.toml   Fly.io deployment
```

## Roadmap

- Tracking what you paid and sold for, to learn your own offer percentage

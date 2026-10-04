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

## How prices are worked out

- **Market value**: the Discogs price suggestion for your record grade, multiplied by a sleeve-condition
  multiplier. The range runs from the next grade down to the next grade up.
- **Sell price**: market value minus an undercut percentage, never below a floor. It's flagged when it comes out
  above the cheapest current listing, since that copy may be in worse shape.
- **Local price**: market value × a local discount × the area-code multiplier. Shown next to what selling on
  Discogs would net after the seller fee.

Every number above comes from [`settings.json`](settings.json). Edit it to change the sleeve multipliers, the
undercut and floor, the Discogs fee, the local discount, regional multipliers by area code, and the currency.

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
  login/               login page
  api/lookup/route.ts  POST /api/lookup: the only place Discogs is called from
  api/login, logout    session cookie in and out
  api/health           public health check (database + which config is set)
middleware.ts          runs the login gate on every request
lib/
  discogs.ts           Discogs client: throttled, retries on 429, catno variants, barcode detection
  pricing.ts           pricing logic (pure functions)
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

- **Collection mode** (in progress): price a whole lot at once. Add records by typing, USB scanner, phone camera or
  pasting a list; pressings that need a choice wait in a "to pick" queue while lookups carry on in the background;
  saved lots show a running low / suggested / high total and can be finished on another device.
  Design: [docs/superpowers/specs/2026-10-04-collection-mode-design.md](docs/superpowers/specs/2026-10-04-collection-mode-design.md)
- Offer calculator for buying collections
- Price cache and a settings page
- CSV export and a printable buy sheet
- Tracking what you paid and sold for, to learn your own offer percentage

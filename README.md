# Mint Condition

Price a vinyl record from its catalog number (or barcode) and condition, using Discogs marketplace data.

Enter a catalog number, the pressing year, and the record and sleeve grades. Mint Condition finds the matching
pressing on Discogs and gives you:

- **Market value**: a low / suggested / high range for your copy's condition.
- **Sell price**: what to list it for on Discogs to undercut comparable copies, and what you'd net after the
  Discogs fee.

For buying collections, **collection mode** prices a whole collection of records at once and works out what to offer the
seller: an opening offer, a ladder to negotiate up, and the most you can pay and still make your margin.

> Discogs figures are asking prices and price suggestions, not confirmed sales. Treat them as a guide.

Mint Condition is **self-hosted**: there is no shared public site. You run your own copy with your own Discogs
token, so your lookups use your own Discogs rate limit (60 requests a minute per IP address) and your price data
stays with you.

If it saves you money at a record fair, you can buy me a coffee:

<a href="https://www.buymeacoffee.com/rgarciadev"><img src="https://img.buymeacoffee.com/button-api/?text=buy%20me%20a%20coffee&emoji=&slug=rgarciadev&button_colour=06bcc1&font_colour=000000&font_family=Inter&outline_colour=000000&coffee_colour=FFDD00" alt="Buy me a coffee" height="44"></a>

## Ways to run it

| | On your computer | Your own Fly.io app |
|---|---|---|
| Good for | Pricing a pile at home | Pricing on your phone at a shop or fair |
| Setup | `npm install`, then `npm run dev` | About 15 minutes ([Get started](#on-flyio)) |
| Login | Off (only you can reach it) | One password, 30-day sessions |
| Camera barcode scanner | On the same computer only | Yes, on your phone |
| Cost | Free | A few dollars a month on Fly (the machine sleeps when idle; check Fly's current pricing) |

Opening a computer copy from your phone over Wi-Fi (`http://192.168.x.x:3000`) works for typing catalog numbers,
but phone browsers only allow the camera on HTTPS, so the scanner needs the Fly version.

## Get started

### What you need

- **Node.js 22.13 or newer** ([nodejs.org](https://nodejs.org)). Check with `node --version`.
- **A Discogs account set up to sell, and a personal access token.** Generate the token at
  [discogs.com/settings/developers](https://www.discogs.com/settings/developers) (**Generate new token**).
  Discogs only returns price suggestions to accounts whose seller settings are complete, including a payment
  method. You don't have to list anything. Without that, lookups find the pressing but show "No price data".
- **For the Fly.io version only:** a [Fly.io](https://fly.io) account with a card on file.

### On your computer

1. Get the code and install it:

   ```sh
   git clone https://github.com/garciaryan/mint-condition.git
   cd mint-condition
   npm install
   ```

2. Create your settings file:

   ```sh
   cp .env.example .env.local
   ```

3. Open `.env.local` and fill in:

   | Variable | What it is |
   |---|---|
   | `DISCOGS_TOKEN` | Your personal access token. It stays on the server and is never sent to the browser. |
   | `DISCOGS_USER_AGENT` | A descriptive User-Agent with your own contact, which Discogs requires, e.g. `MintCondition/0.1 (+you@example.com)`. |

4. Start the app:

   ```sh
   npm run dev
   ```

5. Open http://localhost:3000 and price a record.

Data is kept in `data/mint.db` (SQLite). There's no login on your computer unless you want one: set
`APP_PASSWORD` (at least 12 characters) in `.env.local` and restart. For a faster local server, run `npm run build`
once and then `npm start`.

### On Fly.io

This gives you your own HTTPS address, so the camera scanner works on your phone. It takes about 15 minutes.

1. Install flyctl ([instructions](https://fly.io/docs/flyctl/install/); on a Mac, `brew install flyctl`) and log
   in:

   ```sh
   fly auth login
   ```

2. Do steps 1 and 2 of "On your computer" (clone, `npm install`) if you haven't already.

3. Create your Fly app from the repo's `fly.toml`:

   ```sh
   fly launch --copy-config --no-deploy
   ```

   Pick your own app name when asked (`mint-condition` is taken) and note the region. Answer **no** if asked to add a
   Postgres, Redis or Tigris database.

4. Create the 1 GB volume that holds the database, in the same region:

   ```sh
   fly volumes create mint_data --size 1 --region <your-region>
   ```

5. Set your secrets:

   ```sh
   npm run setup:fly
   ```

   It asks for your Discogs token, a contact for the User-Agent and a login password (at least 12 characters, no `#`), and
   sets them on your app. Typing is hidden for the token and password, and nothing is saved on your computer.

6. Deploy. The first deploy must use `--ha=false` so Fly makes exactly one machine:

   ```sh
   fly deploy --ha=false
   ```

7. Open `https://<your-app>.fly.dev` (also on your phone), log in with your password, and price a record.

Run exactly **one** machine. The database, login limiter and Discogs throttle all live on that one machine.

#### If something goes wrong

- Open `https://<your-app>.fly.dev/api/health`. It lists which settings are present (names only, never values), so
  a missing token or password shows up there. A page that says "Login not configured" names what to fix.
- `fly logs` shows the server's output.
- Run `npm run setup:fly` again to fix a setting; Enter keeps the ones that are right.

#### Changing the password

Run `npm run setup:fly` again and press Enter for everything except the password. [DEPLOY.md](DEPLOY.md) covers
signing out every device, logs, backups and smoke checks.

#### Deploying a fork automatically

If you fork the repo, the GitHub Actions deploy jobs only run on the original repo; to deploy your fork on every
push, change the `if:` line in `.github/workflows/fly-deploy.yml` to your repo and add a `FLY_API_TOKEN` secret.

## Using it

1. **Catalog number or barcode.** Type the catno from the label or spine (`SD 7208`, `SD7208` and `SD-7208` all
   work), or a UPC/EAN barcode. A USB barcode scanner works too: it types the digits and presses Enter.
2. **Pressing year** (optional). Narrows the search to pressings within a year of it.
3. **Record grade and sleeve grade**, on the Goldmine scale: M, NM, VG+, VG, G+, G, F, P.

Or tap the barcode icon to scan the barcode with your phone's camera (HTTPS only).

If several pressings match, you'll get a list grouped by year with cover thumbnails, label, country and format.
Pick the one that matches your copy. Changing a grade afterwards re-prices the same pressing straight away.

The result card shows the three prices, how many copies are for sale on Discogs, the lowest current listing, and a
**Data provided by Discogs** link to the release.

## Collection mode

Price a whole collection at **/collection** (**Collections** in the sidebar). Collections are saved on the server, so you can start one on
a phone and finish it on a laptop.

1. **Create a collection.** Name it and set the default record and sleeve grades; new records start with those.
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
   pressing, and it's priced. The rest of the collection isn't held up.
5. **Totals.** The bar shows low / suggested / high market value for the collection plus coverage, for example
   "62 of 70 priced · 4 to pick …", so you can see how much of the total is still missing.
6. **Grades and re-pricing.** Changing a record's grades re-prices it instantly from the stored Discogs
   suggestions, with no new request. **Re-price all** fetches fresh figures from Discogs for the whole collection.
7. **Make an offer.** Open **Offer** to see what to pay for the cherry-picks or the whole collection (see below).

Totals use the same market value as the single lookup. Like everything here they are asking prices and
suggestions, not sales.

### Offers

Open **Offer** on a collection to see what to offer the seller. It shows two deals side by side:

- **Cherry-picks**: only the valuable records. A record is a pick when its suggested value is at or above the collection's
  **pick threshold** (default $15). Tap the star on a row to add or remove it by hand.
- **Whole collection**: the picks plus everything else at a flat **bulk** price per record (default $0.50). Records that
  aren't priced yet (to pick, no match, no price) count as bulk, and the panel says how many.

Each deal has a **ladder** (30 / 40 / 50 / 60% of the picks' suggested value, opening at 40%) and a **walk-away**:
the most you can pay and still keep your margin:

- **Cherry-picks walk-away** = what the picks would net on Discogs after the fee × (1 − margin) − overhead per pick
  − the collection's overhead (gas, travel), never below $0.
- **Whole-collection walk-away** = the same amount plus the bulk at cost, never below $0. If the collection's overhead is more
  than the picks cover, the whole-collection walk-away comes down by the difference.

"You keep" on each rung is how far that offer is below the walk-away, so it's room to negotiate on top of your
margin, not your profit. Rungs above the walk-away are marked "over max". Offers are whole dollars, rounded down.

For a remote buy from photos, switch on **Condition unverified**: every record is priced one grade lower (record
and sleeve) for the offer only.

The pick threshold, bulk price and collection overhead are set per collection. The ladder, margin (30%), overhead per record
($1.50) and unverified steps are on the [Settings](#settings) page.

### Export and print

- **Export for Discogs** downloads the collection as a Discogs inventory-upload CSV. Upload it on Discogs (Sell Music →
  Inventory Upload). Each priced record becomes a **draft** listing at the app's sell price with its record and
  sleeve grades, so nothing goes live until you review it there. Records with no pressing or no price are left out;
  the line under the link says how many will export and how many can't be listed.
- **Print buy sheet** opens a printer-friendly page for you (not the seller): both offer ladders with the walk-away,
  then every record with a box to tick, its grades, suggested and sell value, and a ★ for picks. Picks and the
  most valuable records come first.

## How prices are worked out

- **Market value**: the Discogs price suggestion for your record grade, multiplied by a sleeve-condition
  multiplier. The range runs from the next grade down to the next grade up.
- **Sell price**: market value minus an undercut percentage, never below a floor, shown with what you'd net
  after the Discogs seller fee. It's flagged when it comes out above the cheapest current listing, since that copy
  may be in worse shape.
- **Offers** (collections only): the ladder is a percentage of the cherry-picks' suggested value, plus the flat bulk price
  for everything else. The walk-away starts from what the picks would net at the sell price after the Discogs fee.
  It then takes off your margin and overhead, and adds the bulk at cost. Details are under
  [Offers](#offers).

Discogs answers are reused for up to 6 hours (set on the [Settings](#settings) page), so re-grading a record or
opening it again is instant. When prices come from that cache the card says how old they are, with **Refresh
prices** to fetch them fresh; a collection's **Re-price all** and **Retry** always fetch fresh, and a collection shows how old its
oldest prices are. Collection prices older than 6 hours are hidden and fetched again when you open the collection (see
[Discogs terms](#discogs-terms)).

Every number above can be changed on the [Settings](#settings) page.

## Dark mode

The app follows your device's light or dark setting. The **theme** menu in the header (System / Light / Dark)
pins one on this browser. Printing always uses the light palette.

## Settings

**Settings** in the nav edits the sleeve multipliers, the undercut, minimum sell price and Discogs fee, the offer
ladder, opening offer, margin, overhead, pick threshold, bulk price and unverified steps, and how many hours
Discogs answers are cached (0 to 6; 0 turns the cache off). Each field's ⓘ says what it changes.
Multipliers are shown as percentages (a VG sleeve keeps 85% of market value).

- A save applies straight away to new lookups and to every collection, including collections you already made offers on.
- Each changed field shows its default; **Reset to defaults** goes back to [`settings.json`](settings.json).
- Saved values live in the database and win over `settings.json`. A setting added to the file later still gets
  its default.
- The currency follows your Discogs seller account and isn't editable.

## Discogs terms

Each copy uses its owner's Discogs token, so whoever runs a copy agrees to the
[Discogs API Terms of Use](https://support.discogs.com/hc/en-us/articles/360009334593-API-Terms-of-Use). The app
is built to follow them:

- No Discogs data is shown more than 6 hours old: the cache is capped at 6 hours, and older collection prices are hidden
  until they are fetched again.
- Discogs data carries a **Data provided by Discogs** link to the release, and every page has the required
  not-affiliated notice in the footer.

What the app can't enforce is how it's used. Discogs treats marketplace data, including price suggestions, as
restricted: it may not be used commercially or passed on to third parties. Run your copy for yourself; don't put
it up as a public or paid service for other people.

This application uses Discogs' API but is not affiliated with, sponsored or endorsed by Discogs. 'Discogs' is a
trademark of Zink Media, LLC.

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
npm run setup:fly      # set your Fly app's secrets (interactive)
npm run hash-password  # optional: make an APP_PASSWORD_HASH instead of APP_PASSWORD (interactive)
```

```
app/                   Next.js App Router UI
  page.tsx             page shell
  Lookup.tsx           form, pressing picker, result card
  Picker.tsx, GradeSelect.tsx  shared by the lookup page and collections
  SiteHeader.tsx, SiteNav.tsx  sidebar nav (bottom tab bar on phones)
  SiteFooter.tsx       footer: links and the Discogs notice
  collection/          /collection collections list; [id]/ is one collection (entry bar, camera scanner, paste, to-pick
                       panel, totals, offer panel, rows)
  login/               login page
  settings/            /settings page (SettingsForm)
  api/lookup/route.ts  POST /api/lookup: Discogs lookups for the single-record page (collections use the worker)
  api/sessions/        collections: list/create, one collection, add items (bulk), re-price all
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
  discogs-terms.ts     what the Discogs API terms require: 6-hour limit, notice and credit text
  route-auth.ts        per-route session check
  collection/          collections: types, store (SQLite), parse (paste), view (pure totals/prices), ui, worker
  lookup.ts            request validation, search-or-price flow, error mapping
  form.ts              client-side form checks and picker grouping
  auth.ts, password.ts session cookies, login limiter, password hashing
  gate.ts              decides who gets through (pure function)
  db.ts, migrations.ts SQLite (data/ locally, the Fly volume in production), versioned migrations
  settings.ts          settings.json loader, validator, merge of saved values over defaults
  settings-store.ts    saved settings (one SQLite row) over the settings.json defaults
  settings-form.ts     settings page form: percent conversion and field checks (client-safe)
  types.ts             grades and shared types
scripts/               command-line lookup, setup:fly, password hashing
tests/                 unit tests
settings.json          pricing tunable defaults
Dockerfile, fly.toml   Fly.io deployment
```

## Roadmap

- Tracking what you paid and sold for, to learn your own offer percentage

## License

[MIT](LICENSE). Bugs and ideas are welcome as GitHub issues.

# Deploying to Fly.io

Mint Condition runs as exactly one Fly machine with a 1 GB volume at `/data` (SQLite). Docker is not needed locally; `fly deploy` builds on Fly's remote builder.

## 1. Prerequisites

```sh
brew install flyctl
fly auth login
```

## 2. First-time setup

From the repo root:

```sh
fly launch --no-deploy --copy-config
fly volumes create mint_data --size 1 --region sjc
```

- `--copy-config` keeps the checked-in `fly.toml`. If `mint-condition` is taken, pick another app name when prompted (and update `app` in `fly.toml`).
- Use the same region as `primary_region` in `fly.toml` (`sjc`). If you launch in a different region, change both.
- If asked to create a Postgres/Redis/Tigris database, answer no.

## 3. Secrets

From the repo root, run:

```sh
npm run setup:fly
```

It checks that `fly` is installed and logged in, reads the app name from `fly.toml`, and asks for:

- your Discogs personal access token (the one from your seller account; typing is hidden),
- a contact (email or URL) for the Discogs User-Agent, which becomes `MintCondition/0.1 (+<contact>)`,
- a login password, twice (at least 12 characters; typing is hidden). It can't contain `#`, which `fly secrets
  import` treats as the start of a comment.

It sends them to `fly secrets import` on stdin, so they never land in your shell history, and prints only the names
it set. Re-run it any time to change the password or token: pressing Enter keeps what is already set. The Discogs
token stays server-side.

The session secret (which signs login cookies) is made automatically: on first boot the app writes 32 random bytes to
`/data/session-secret` and reuses it after that.

### By hand

If you'd rather set them yourself (quote values with spaces or `$`):

```sh
fly secrets set \
  DISCOGS_TOKEN=your_discogs_token \
  DISCOGS_USER_AGENT="MintCondition/0.1 (+you@example.com)" \
  APP_PASSWORD='at least twelve characters'
```

Instead of `APP_PASSWORD` you can store a scrypt hash: `npm run hash-password` prints one for `APP_PASSWORD_HASH`
(single-quote it; it contains `$`). Set one or the other, not both. You can also set `SESSION_SECRET` yourself
(`openssl rand -base64 32`); when it is set, the generated file is not used.

Auth modes: in production a password (`APP_PASSWORD` or `APP_PASSWORD_HASH`) is required. Without one, setting both,
or an `APP_PASSWORD` under 12 characters, the app answers 503 with the reason, and `/api/health` shows which
settings are present (names only; for the password, just whether one is set) and where the session secret came from (`env` or `file`). Locally, with no
password set, login is off and the server logs a warning once.

## 4. Deploying

Docker is not needed locally. Before a first deploy (or after changing the Dockerfile), you can confirm the image builds on Fly's remote builder:

```sh
fly deploy --build-only
```

The first deploy must pass `--ha=false`, otherwise Fly creates two machines. This app must run one machine only (SQLite file, in-memory login limiter and Discogs throttle).

```sh
fly deploy --ha=false
```

Later deploys happen automatically (see below), or by hand:

```sh
fly deploy
```

### Automatic deploys

Every push to `main` runs `.github/workflows/fly-deploy.yml`. It runs `npm test`, `npm run typecheck` and
`npm run build`; only if all pass does it build one Docker image, push it to
`ghcr.io/garciaryan/mint-condition:<tag>`, deploy it to this app (the canary, `flyctl deploy --image`), tag the
release, and then deploy the same image to every shop app (§10). A failing check means nothing is deployed, and a
canary that fails its health check means no shop is touched; see the run under the repo's **Actions** tab.

#### Versions and releases

Each successful automatic deploy is tagged `v<base>-alpha.<N>` and gets a GitHub pre-release whose notes list the PRs
merged since the last one. The same tag names the image on ghcr.io, so any release can be redeployed by tag. The
tag is pushed before the image is built, which claims the number: no two runs ever build the same `alpha.N`. `<base>` is `version` in `package.json` (plain `x.y.z`, currently `0.1.0`), and `N` counts up
from 1 for each base (`scripts/next-version.ts`, logic in `lib/version.ts`). The tag is passed to the image build as
`APP_VERSION`, so the running app knows it: `/api/health` reports `"version"` and `/settings` shows it at the bottom,
linked to the release. A run that fails after claiming its number (build, canary or release) leaves a bare tag with
no release, so release numbers can have gaps; the next run takes the next number. Local builds and manual
`fly deploy` from source say `dev`.

- **Start a new line** (for example after a phase that changes the database): change `version` in `package.json` to
  `0.2.0` in a PR. The next deploy is `v0.2.0-alpha.1`.
- **Leave alpha** later by changing the `-alpha.` suffix in `lib/version.ts` and the workflow's `--prerelease` flag.

The workflow authenticates with the `FLY_API_TOKEN` repo secret, a Fly deploy token scoped to this app that
**expires 2027-10-04**. To renew it (or replace a leaked one):

```sh
fly tokens list                         # find the old "github-actions" token
fly tokens revoke <token-id>
fly tokens create deploy --name github-actions --expiry 8760h | gh secret set FLY_API_TOKEN -R garciaryan/mint-condition
```

Verify:

```sh
curl https://<app>.fly.dev/api/health
```

Expect 200 `{"ok":true,...,"version":"v0.1.0-alpha.N"}`. A 503 means something is wrong: the `config` map shows which variables are `false` (names only, never values), and `db: "error"` means the database check failed (details are in `fly logs`).

Post-deploy smoke checklist (replace `<app>` with your app name):

```sh
# 1. Health: 200 and "ok":true
curl -s https://<app>.fly.dev/api/health

# 2. Unauthenticated page: 307 redirect to /login?next=%2F
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' https://<app>.fly.dev/

# 3. Lookup API without a session, same origin: 401 with kind "auth"
curl -s -i -X POST https://<app>.fly.dev/api/lookup -H 'Origin: https://<app>.fly.dev' -H 'content-type: application/json' -d '{}'

# 4. Same request from a foreign origin: 403
curl -s -i -X POST https://<app>.fly.dev/api/lookup -H 'Origin: https://evil.example' -H 'content-type: application/json' -d '{}'

# 5. Session cookie flags: Set-Cookie must contain Secure and HttpOnly (use your real password, then clear shell history)
curl -s -i -X POST https://<app>.fly.dev/api/login -H 'Origin: https://<app>.fly.dev' -H 'content-type: application/json' -d '{"password":"your-password"}' | grep -i '^set-cookie'

# 6. Exactly one machine
fly status
```

Instead of step 5 you can log in through the browser and check in devtools that the `mc_session` cookie is Secure and HttpOnly.

Troubleshooting: the container starts as root, `docker-entrypoint.sh` chowns `/data` to `node`, then runs the app as `node`. If `/api/health` reports a db error on the first deploy, check `fly logs` for an entrypoint or permission error, and confirm the volume exists (`fly volumes list`) and is mounted at `/data`.

## 5. Logs

```sh
fly logs
```

## 6. Logging out everywhere, and changing the password

Sessions are signed with the session secret. Making a new one ends every session (30-day cookies included). If the
app made the secret itself (the usual case), delete the file and restart:

The app's machine stops when idle and `fly ssh` needs it running, so start it first:

```sh
fly machine start
fly ssh console -C "rm /data/session-secret"
fly apps restart
```

If you set `SESSION_SECRET` yourself, set a new value instead (`fly secrets set SESSION_SECRET=...`, which restarts
the app).

To change the password, run `npm run setup:fly` again and press Enter for everything but the password. It replaces an
old `APP_PASSWORD_HASH` if you had one. Existing sessions stay signed in; make a new session secret as above to end
them too.

## 7. Backups

Fly takes daily volume snapshots automatically (retained 5 days by default).

```sh
fly volumes list
fly volumes snapshots list <volume-id>
```

Restore from a snapshot. These steps are untested; if the machine still runs, take a fresh `fly ssh sftp get` copy first (below). Volumes cannot be renamed, and a machine is bound to one volume id, so the machine has to be recreated:

```sh
# 1. Pick a snapshot
fly volumes list
fly volumes snapshots list <volume-id>

# 2. Destroy the machine
fly machine list
fly machine destroy <machine-id> --force

# 3. Destroy the old volume
fly volumes destroy <old-volume-id>

# 4. Create the replacement from the snapshot (keep the name mint_data)
fly volumes create mint_data --snapshot-id <snapshot-id> --region sjc --size 1

# 5. Redeploy (creates one machine and attaches the new volume)
fly deploy --ha=false

# 6. Verify
curl https://<app>.fly.dev/api/health
```

Step 3 can wait until the restore is confirmed, but then two `mint_data` volumes exist and the new machine may pick the wrong one. Confirm the snapshot id and destroy the old volume before step 4.

Copy the database file off the machine for your own backup. The machine suspends when idle, so wake it first (`fly machine start <machine-id>`, or request `/api/health`):

```sh
fly ssh sftp get /data/mint.db
```

The database runs in WAL mode, so recent writes may sit in `/data/mint.db-wal`; fetch that file too if it exists. Volume snapshots are the safer backup.

## 8. Keep one machine

Do not scale up. Keep exactly one machine (`fly scale count 1` if it ever drifts; check with `fly status`). `fly.toml` stops the machine when idle and starts it on request, so the first request after a while is slow. That is expected.

## 9. Testing changes before production

There is no staging app (it was retired on 2026-10-05). Every push to `main` deploys production, so check changes
locally first.

### Migrations: run them on a copy of the production database

Start the machine (request `/api/health`), then copy the database into an ignored folder. Fetch the WAL file too
if it exists, so recent writes come along:

```sh
mkdir -p data/prod-copy && cd data/prod-copy
fly ssh sftp get /data/mint.db
fly ssh sftp get /data/mint.db-wal   # may not exist; that's fine
cd ../..
DATA_DIR=data/prod-copy npm run dev
```

The app runs pending migrations when it opens the database, so starting it is the migration test. Then use it:
open a collection, change a grade, open Settings. This uses your real Discogs token from `.env.local`, and opening a collection
whose prices are more than 6 hours old re-prices that collection. Delete `data/prod-copy` when you're done; it is a copy
of your real data.

### Phone checks: open your computer's copy over HTTPS

Phone browsers only allow the camera on HTTPS, so `http://192.168.x.x:3000` can't test the scanner. A tunnel gives
your local copy an HTTPS address. For example, with [Tailscale](https://tailscale.com) on both the computer and the
phone:

```sh
npm run build && npm start
tailscale serve 3000        # prints an https://<machine>.<tailnet>.ts.net address
```

Set `APP_PASSWORD` in `.env.local` first if the tunnel can be reached by anyone but you
(a public tunnel such as `cloudflared` can be). This route is untested: if saving anything fails with
"Cross-origin request blocked", the tunnel is changing the `Host` header, which the login gate checks against
`Origin`.

For small changes it is also reasonable to merge and check on production, since you are its only user and the
database only changes through migrations.

## 10. Hosting a shop

Each record shop gets its own Fly app in its own Fly organization: its own URL, database, password, Discogs access and
rate limit, and its own bill. Every push to `main` deploys the canary (this app) first and then each shop listed in
the `FLY_SHOP_APPS` repo variable, all from the same image. A shop whose deploy fails keeps running its previous
version; re-run just that job from the Actions run.

### The image must be public

Fly pulls `ghcr.io/garciaryan/mint-condition` without credentials, so the package must be public. Pushed from this
public repo it was public from the first run (checked 2026-10-08: an anonymous pull of `v0.1.0-alpha.2` succeeds). If a
canary ever fails to pull the image, open the repo's **Packages** → `mint-condition` → **Package settings** and check
the visibility is **Public**, then **Re-run failed jobs**. The image holds only the public code; secrets are Fly
secrets, set at runtime.

### Add a shop

Pick a short lowercase name, e.g. `groove`; the app is `mc-groove`. About 15 minutes:

```sh
fly orgs create mc-groove                                   # then add a payment method to the org on fly.io
fly apps create mc-groove --org mc-groove
fly volumes create mint_data -a mc-groove --region <nearest region> --size 1
npm run setup:fly -- --app mc-groove                        # password, user agent, Discogs consumer key/secret
fly deploy --image ghcr.io/garciaryan/mint-condition:<latest tag> -a mc-groove --primary-region <same region> --ha=false
curl https://mc-groove.fly.dev/api/health                   # "version" is that tag; then log in
fly tokens create deploy -a mc-groove | gh secret set FLY_TOKEN_GROOVE -R garciaryan/mint-condition
gh variable set FLY_SHOP_APPS -R garciaryan/mint-condition \
  --body '[{"app":"mc-groove","token":"FLY_TOKEN_GROOVE"}]'  # the whole list: keep the shops already in it
```

- The first deploy is by hand, before the shop is listed: `--primary-region` puts the machine next to its volume
  (`fly.toml` says `sjc`) and `--ha=false` keeps it to one machine (§4). The workflow only updates apps that already
  have their machine.
- Read the current list first with `gh variable get FLY_SHOP_APPS -R garciaryan/mint-condition`. Each entry is the
  app and the name of the secret holding its deploy token. The workflow checks the list before deploying anything
  (`lib/shops.ts`) and stops the run with a message if an entry is wrong; a token secret that's missing fails only
  that shop, naming the secret.
- `setup:fly --app` asks for the Discogs consumer key and secret (hidden; Enter keeps a current one). They belong to
  your one registered Discogs application, "Mint Condition", the same for every shop. The shop's first visit is: log
  in, then press **Connect Discogs** in the Account card on Settings (its Discogs section) and approve on discogs.com. Its prices
  then come from its own seller account, stored in its own database; no token of yours is involved.
- If the shop app still has `DISCOGS_TOKEN` set, it uses that token and Connect Discogs doesn't appear; `setup:fly
  --app` warns about it. Remove it with `fly secrets unset DISCOGS_TOKEN -a <app>`.
- One-time, for the first shop: register the application at discogs.com → Settings → Developers → Create an
  Application (name "Mint Condition"), and keep the consumer key and secret for `setup:fly`.
- Local test of the flow: put `DISCOGS_CONSUMER_KEY` and `DISCOGS_CONSUMER_SECRET` in `.env.local`, leave
  `DISCOGS_TOKEN` out, run `npm run dev` and use Connect Discogs on http://localhost:3000.

### Roll back one app

```sh
fly deploy --image ghcr.io/garciaryan/mint-condition:<older tag> -a <app>
```

The next push to `main` brings it forward again.

### Remove a shop

Take its entry out of `FLY_SHOP_APPS`, run `gh secret delete FLY_TOKEN_<SHOP> -R garciaryan/mint-condition`, then
either `fly apps destroy <app>` or hand the Fly org over to the shop.

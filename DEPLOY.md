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

Generate the password hash (needs an interactive terminal; prompts twice, minimum 12 characters) and a session secret:

```sh
npm run hash-password
openssl rand -base64 32
```

Then set all four secrets. The hash contains `$`, so single-quote it. The user agent contains spaces and parentheses, so quote it too.

```sh
fly secrets set \
  DISCOGS_TOKEN=your_discogs_token \
  DISCOGS_USER_AGENT="MintCondition/0.1 (you@example.com)" \
  APP_PASSWORD_HASH='paste-the-hash-here' \
  SESSION_SECRET=paste-the-openssl-output
```

The Discogs token is the personal access token from your seller account. It stays server-side.

Auth modes: in production, `APP_PASSWORD_HASH` and `SESSION_SECRET` must both be set. If only one is set (or neither, in production), the app answers 503 and `/api/health` names the missing variables. Local dev with neither set has login off and logs a warning once.

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
`npm run build`, and only if all pass does it run `flyctl deploy --remote-only`. A failing check means nothing is
deployed; see the run under the repo's **Actions** tab.

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

Expect 200 `{"ok":true,...}`. A 503 means something is wrong: the `config` map shows which variables are `false` (names only, never values), and `db: "error"` means the database check failed (details are in `fly logs`).

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

## 6. Logging out everywhere

Sessions are signed with `SESSION_SECRET`. Rotating it invalidates every session (30-day cookies included):

```sh
fly secrets set SESSION_SECRET=$(openssl rand -base64 32)
```

This restarts the app. To change the password, run `npm run hash-password` and set a new `APP_PASSWORD_HASH` the same way (rotate `SESSION_SECRET` too to end existing sessions).

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

Copy the database file off the machine for your own backup. The machine auto-stops when idle, so start it first (`fly machine start <machine-id>`, or request `/api/health`):

```sh
fly ssh sftp get /data/mint.db
```

The database runs in WAL mode, so recent writes may sit in `/data/mint.db-wal`; fetch that file too if it exists. Volume snapshots are the safer backup.

## 8. Keep one machine

Do not scale up. Keep exactly one machine (`fly scale count 1` if it ever drifts; check with `fly status`). `fly.toml` stops the machine when idle and starts it on request, so the first request after a while is slow. That is expected.

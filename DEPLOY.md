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

The first deploy must pass `--ha=false`, otherwise Fly creates two machines. This app must run one machine only (SQLite file, in-memory login limiter and Discogs throttle).

```sh
fly deploy --ha=false
```

Later deploys:

```sh
fly deploy
```

Verify:

```sh
curl https://<app>.fly.dev/api/health
```

Expect 200 `{"ok":true,...}`. A 503 lists which config variable names are missing (names only, never values).

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

Copy the database file off the machine for your own backup:

```sh
fly ssh sftp get /data/mint.db
```

The database runs in WAL mode, so recent writes may sit in `/data/mint.db-wal`; fetch that file too if it exists. Volume snapshots are the safer backup.

## 8. Keep one machine

Do not scale up. Keep exactly one machine (`fly scale count 1` if it ever drifts; check with `fly status`). `fly.toml` stops the machine when idle and starts it on request, so the first request after a while is slow. That is expected.

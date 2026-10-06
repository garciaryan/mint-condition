# Simpler login setup: design

Date: 2026-10-05 · Status: approved in chat, awaiting spec review

## Goal

Make self-hosting simpler without weakening security. Today a Fly deploy needs a scrypt hash from
`npm run hash-password`, a session secret from `openssl rand`, and a hand-quoted `fly secrets set` (the hash contains
`$`). After this change a new deploy sets one login-related secret, the password, and a script sets every secret
without the user typing any `fly secrets` command.

Success:
- A new self-hoster can go from clone to a working Fly app by following README "Get started" step by step, never
  hashing anything, running `openssl`, or quoting a secret.
- Existing deploys (`APP_PASSWORD_HASH` + `SESSION_SECRET`, like the owner's) keep working with no action.
- Running locally with nothing set still has login off.

Out of scope: automating `fly launch`, volume creation or deploys (secrets only); a set-password-on-first-visit
screen (rejected: whoever reaches a fresh deploy first would own it); deriving the session secret from the
password (rejected: any session cookie would allow fast offline password guessing).

## 1. Choosing the login settings (`lib/auth.ts`, pure)

Password source: `APP_PASSWORD` (plain) or `APP_PASSWORD_HASH` (scrypt, as now). Values are trimmed; blank = unset.

| Situation | Mode |
|---|---|
| `APP_PASSWORD` and `APP_PASSWORD_HASH` both set | misconfigured: "Set only one of APP_PASSWORD and APP_PASSWORD_HASH." |
| `APP_PASSWORD` shorter than 12 characters | misconfigured: "APP_PASSWORD must be at least 12 characters." (never the value) |
| A password set, `SESSION_SECRET` set (env or generated file, see §2) | on |
| A password set, no session secret | misconfigured, missing SESSION_SECRET (only reachable if §2 did not run, e.g. a script or test) |
| No password, not production | off (unchanged; middleware logs a warning once) |
| No password, production | misconfigured, missing APP_PASSWORD |
| `SESSION_SECRET` set with no password | misconfigured, missing APP_PASSWORD (as today: it signals login was intended) |

`AuthMode` "on" carries `password: { kind: "plain"; value } | { kind: "hash"; value }` instead of `passwordHash`.
`misconfigured` carries a human message (the gate's 503 text) as well as the missing names.

Password check (`lib/password.ts`, `checkPassword(input, password)`): `hash` uses the existing `verifyPassword`;
`plain` compares SHA-256 digests of input and stored value with `timingSafeEqual` (equal-length buffers, so time
does not depend on how close a guess is). The login route uses `checkPassword`; the login limiter (5 tries per IP
per 15 minutes) is unchanged.

`configStatus` (health) keeps reporting booleans only: `DISCOGS_TOKEN`, `DISCOGS_USER_AGENT`, `APP_PASSWORD`,
`APP_PASSWORD_HASH`, `SESSION_SECRET`, plus `sessionSecretSource: "env" | "file" | null`. No values, ever.

## 2. Generated session secret (`lib/session-secret.ts`, run at boot)

`ensureSessionSecret(env, dataDir)` is called from `instrumentation.ts` (nodejs runtime) before anything else:
- If `SESSION_SECRET` is set in the environment, or no password is set: do nothing (source `env` or none).
- Otherwise read `<DATA_DIR>/session-secret` (`DATA_DIR` defaults to `./data`, `/data` on Fly). If it does not exist,
  create it with 32 random bytes as base64, using exclusive create (`flag: "wx"`, mode `0o600`), creating the
  directory if needed. If the exclusive create loses a race (`EEXIST`), read the existing file.
- An empty or unreadable existing file is a startup error with a clear message (path and fix: delete the file to
  make a new one). It is never silently regenerated, since that would log everyone out without explanation.
- Sets `process.env.SESSION_SECRET` and records the source as `file`, so the gate, login route and health code read
  it as before.

Rotation: delete the file and restart (`fly ssh console -C "rm /data/session-secret"`, then `fly apps restart`), or
set `SESSION_SECRET` explicitly, which always wins. A file on the volume is as exposed as the database next to it;
anyone who can read the volume can already deploy code to the app.

## 3. `npm run setup:fly` (`scripts/setup-fly.ts`)

Sets the app's secrets without the user typing `fly secrets`. Re-runnable (for example to change the password).

1. Preflight: `fly` (or `flyctl`) on PATH, `fly auth whoami` succeeds, and `fly.toml` has an `app = "..."`;
   otherwise stop with the exact fix (install link, `fly auth login`, or `fly launch --copy-config --no-deploy`).
   Lists the app's current secret names with `fly secrets list -a <app> --json` (names only).
2. Prompts, in a TTY only (non-TTY stops with a message, like `hash-password`):
   - Discogs token: hidden. Required on first setup; Enter keeps the current one if `DISCOGS_TOKEN` already exists.
   - User-Agent: visible, with a default built from a prompted contact (`MintCondition/0.1 (+<contact>)`); Enter
     keeps the current one if set.
   - Password: hidden, asked twice, at least 12 characters, must match; Enter keeps the current one if a password
     secret already exists.
   Validation lives in pure functions (`lib/setup-fly.ts`) with unit tests.
3. Applies: if anything changed, pipes `NAME=VALUE` lines to `fly secrets import -a <app>` on stdin (so values never
   appear in shell history, `ps`, or files). If a new `APP_PASSWORD` is set and `APP_PASSWORD_HASH` exists, runs
   `fly secrets unset APP_PASSWORD_HASH -a <app>` after the import succeeds, since setting both is an error.
   Values containing a newline are rejected at the prompt (they would break the import format).
4. Prints the names it set or removed (never values) and the next step (`fly deploy --ha=false` on a first deploy;
   setting secrets on a deployed app restarts it).

`fly` is called through a small wrapper (`spawn` with an args array, no shell), so the script is testable by
faking the wrapper; tests cover the import text, the unset decision and the prompt validators.

## 4. Docs

- **README "Get started"** (new section, replacing "Requirements", "Run it on your computer" and "Run it on Fly.io"):
  detailed numbered steps.
  - What you need: Node 22.13+, a Discogs seller account with a personal access token (with the existing note on
    complete seller settings), and for Fly a Fly.io account and card.
  - On your computer: clone, `npm install`, `cp .env.example .env.local`, fill in the two Discogs values (table),
    `npm run dev`, open localhost:3000; optional `APP_PASSWORD` in `.env.local` for a login; `npm run build` +
    `npm start` for a faster server.
  - On Fly.io: install flyctl and `fly auth login`; `fly launch --copy-config --no-deploy` (pick an app name and
    region, answer no to databases); `fly volumes create mint_data --size 1 --region <region>`;
    `npm run setup:fly`; `fly deploy --ha=false`; open `https://<app>.fly.dev` and log in; what to do if a step
    fails (health endpoint names missing settings); changing the password later (re-run `npm run setup:fly`).
  - Keeps the one-machine warning and the fork / GitHub Actions note.
- **DEPLOY.md §3** becomes "run `npm run setup:fly`" with the manual `fly secrets set` (plain `APP_PASSWORD`) and
  the `APP_PASSWORD_HASH` route as fallbacks; the auth-modes paragraph, password change and secret rotation
  sections are updated for §1 and §2.
- **`.env.example`** gains a commented `# APP_PASSWORD=` line explaining login is optional locally.
- **CLAUDE.md**: the "Decisions already made" auth line and the layout list (`lib/session-secret.ts`,
  `scripts/setup-fly.ts`, `lib/setup-fly.ts`).

## Testing

- `lib/auth.ts`: every row of the table in §1, including trimming and both-set; `configStatus` never includes values.
- `checkPassword`: plain right/wrong/different lengths, hash right/wrong, malformed hash.
- `ensureSessionSecret` in a temp dir: env wins; no password does nothing; creates a 0600 file once and reuses it;
  `EEXIST` race reads the existing file; an empty file throws with the path.
- Gate and login route tests updated for the new mode shape; a login test with `APP_PASSWORD`.
- `lib/setup-fly.ts`: import text, unset decision, validators (length, match, newline, keep-current).
- Manual: `NODE_ENV=production` local run with only `APP_PASSWORD` set (file appears in `DATA_DIR`, login works,
  restart keeps the session); the owner's existing settings still work; `npm run setup:fly` against a throwaway Fly
  app only if the owner wants (it is never run against production by the build).

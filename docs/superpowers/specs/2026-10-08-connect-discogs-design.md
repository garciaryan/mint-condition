# Connect Discogs (OAuth 1.0a)

Date: 2026-10-08 · Status: building on `feat/connect-discogs`. Live check 2026-10-08: with the registered "Mint Condition" application, request_token accepted a per-request `oauth_callback` for both `https://mint-condition.fly.dev/api/discogs/callback` and `http://localhost:3000/api/discogs/callback` (200, `oauth_callback_confirmed=true`), so one registration serves every shop; the HMAC-SHA1 signing (lib/discogs-oauth.ts) is accepted by Discogs. Checks 3 (API calls signed with an access token) run in Task 9
Second of two sub-projects for hosting record shops; the first is the multi-app deploy
(`docs/superpowers/specs/2026-10-07-multi-app-deploy-design.md`). Phase 14 (inventory and wantlist) will reuse this
connection.

## Why

Asking a record shop for a Discogs personal access token would put them off. Instead, a shop opens its app, logs in,
presses **Connect Discogs**, approves on discogs.com, and comes back to a working app.

Success:
- A fresh shop app with no `DISCOGS_TOKEN` goes from login → Connect → a priced record in under a minute.
- Disconnecting stops all Discogs calls; the next lookup shows the Connect card.
- A revoked connection says "Reconnect Discogs", not a raw 401.
- The owner's own app, local dev and the `lookup` CLI keep working on `DISCOGS_TOKEN`, unchanged.

## Decisions (from brainstorming)

- **Both modes; the token wins.** `DISCOGS_TOKEN` set → used as today. Otherwise the app uses its stored OAuth
  connection.
- **One Discogs application** registered by the owner ("Mint Condition"); every shop app carries its consumer key and
  secret (`DISCOGS_CONSUMER_KEY`, `DISCOGS_CONSUMER_SECRET`, Fly secrets) and each shop authorizes it with its own
  account.
- **Hand-written OAuth 1.0a**, HMAC-SHA1 via `node:crypto`; no new dependency (runtime deps stay Next, React and
  `barcode-detector`). Rejected: an npm OAuth library; storing the connection as a Fly secret (needs a Fly API token
  in the app, restarts on every change).
- **Stored in SQLite, unencrypted.** OAuth 1.0a requests must also be signed with the consumer secret, which is a Fly
  secret and never on the volume, so a copy of the database (snapshot, DEPLOY.md §9 local copy) can't call Discogs as
  the shop.
- **Out of scope:** inventory and wantlist (Phase 14); removing token support; encrypting the stored token.

## Discogs OAuth flow (from the maintained `joalla/discogs_client`; to be confirmed live, below)

1. `POST https://api.discogs.com/oauth/request_token` with `oauth_callback` in the signed header → form-encoded
   `oauth_token`, `oauth_token_secret`.
2. Browser to `https://www.discogs.com/oauth/authorize?oauth_token=<token>`.
3. Discogs redirects to the callback with `oauth_token` and `oauth_verifier` (or `denied`).
4. `POST https://api.discogs.com/oauth/access_token` signed with the request token secret and the verifier → access
   `oauth_token`, `oauth_token_secret` (they don't expire).
5. `GET https://api.discogs.com/oauth/identity` → `username`.
6. Every API call: `Authorization: OAuth …` signed with consumer secret `&` access token secret.

## Live checks first (before any UI)

With the owner's Discogs account and the registered application, and the results written into this spec's Status:
1. A request token with `oauth_callback=https://<some app>.fly.dev/api/discogs/callback` is accepted (a per-request
   callback). If Discogs only allows the registered callback, one registration can't serve every shop; the fallback is
   one Discogs application per shop (consumer keys per app, same code).
2. `http://localhost:3000/api/discogs/callback` works, for local dev.
3. `/marketplace/price_suggestions/{id}`, `/releases/{id}` and `/masters/{id}/versions` answer with OAuth signing, the
   same as with the token.

## Signing: `lib/discogs-oauth.ts` (pure, `node:crypto` only)

```ts
export type OAuthParams = {
  method: "GET" | "POST"; url: string;              // url may carry a query string
  consumerKey: string; consumerSecret: string;
  token?: string; tokenSecret?: string; callback?: string; verifier?: string;
  nonce: string; timestamp: number;                 // injected, so tests are fixed
};
export function oauthHeader(p: OAuthParams): string;                    // "OAuth oauth_consumer_key=\"…\", …"
export function parseTokenBody(text: string): { token: string; secret: string };  // throws on missing fields
export function callbackUrl(host: string, proto: string | null): string;
```

- RFC 5849: signature base string = method `&` encoded base URL (no query) `&` encoded sorted parameters (oauth_*
  except `oauth_signature`, plus the URL's query parameters); key = `enc(consumerSecret)&enc(tokenSecret ?? "")`;
  `oauth_signature_method="HMAC-SHA1"`, `oauth_version="1.0"`. Percent-encoding per RFC 3986 (unreserved
  `A-Z a-z 0-9 - . _ ~` only).
- `callbackUrl`: `${proto === "http" && host.startsWith("localhost") ? "http" : "https"}://${host}/api/discogs/callback`
  (Fly terminates TLS; `x-forwarded-proto` and `host` come from the request).

## Storage: migration 7 + `lib/discogs-auth-store.ts`

```sql
CREATE TABLE discogs_auth (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  token TEXT, secret TEXT, username TEXT, connected_at INTEGER,
  pending_token TEXT, pending_secret TEXT, pending_at INTEGER
);
```

```ts
export type Connection = { token: string; secret: string; username: string; connectedAt: number };
export function getConnection(db): Connection | null;
export function saveConnection(db, c: Connection): void;       // also clears pending
export function clearConnection(db): void;
export function savePending(db, token: string, secret: string, at: number): void;
export function takePending(db, token: string, now: number): { secret: string } | null;
// matches `token` and is younger than PENDING_MAX_MS = 10 min; always clears the pending columns
```

Saving or clearing a connection also deletes every `discogs_cache` row (cached answers belong to one seller account and
its currency).

## Which access the app uses: `lib/discogs-access.ts`

```ts
export type DiscogsAccess =
  | { kind: "token"; token: string }
  | { kind: "oauth"; consumerKey: string; consumerSecret: string; token: string; secret: string; username: string }
  | { kind: "none"; reason: "not-connected" | "setup" };
export function discogsAccess(env, connection: Connection | null): DiscogsAccess;   // pure
```

- `DISCOGS_TOKEN` (trimmed, non-empty) → `token`.
- Else both consumer vars set and a connection → `oauth`.
- Else both consumer vars set → `none / not-connected`.
- Else → `none / setup`.
- `DISCOGS_USER_AGENT` stays required in every mode (missing → `setup`).

## Client: `lib/discogs.ts`, `lib/discogs-client.ts`

- `DiscogsClient` takes `auth: () => DiscogsAccess` (plus injectable `nonce()` for tests) instead of `token`. Each
  request builds `Discogs token=…` or a fresh `oauthHeader` (new nonce and timestamp). `kind: "none"` throws a
  `DiscogsError` with status 0 and kind `not-connected`.
- The shared client stays one instance (one throttle); `getDiscogsClient()` wires
  `auth = () => discogsAccess(process.env, getConnection(getDb()))`, so connect/disconnect apply at once.
- A 401 under OAuth → `DiscogsError` 401 with "Discogs no longer accepts this app's access. Reconnect Discogs in
  Settings." The connection is not deleted automatically.
- `scripts/lookup.ts` keeps using `DISCOGS_TOKEN` (`auth: () => ({ kind: "token", token })`).

## Routes and errors

- `lib/lookup.ts`: `missingEnv` is replaced by `discogsReady(access): LookupError | null` — `not-connected` →
  `{ kind: "not-connected", message: "Connect your Discogs account to start pricing." }` (HTTP 409);
  `setup` → today's `missing-env` (500), naming the missing variables, never values. `LookupErrorKind` gains
  `not-connected`. Used by `/api/lookup`, `/api/releases/:id/identifiers`, `/api/masters/:id/versions`.
- `toErrorResponse`: a 401 under OAuth gives the Reconnect message (kind `bad-token`).
- **`POST /api/discogs/connect`** (session; same-origin via the gate): needs consumer vars (else 503 JSON
  `setup`); token mode → `303 /settings`. Gets a request token with `callbackUrl(host, x-forwarded-proto)`,
  `savePending`, → `303 https://www.discogs.com/oauth/authorize?oauth_token=…`. A Discogs error → `303
  /settings?discogs=error`.
- **`GET /api/discogs/callback`** (session): `denied` → `303 /settings?discogs=denied`; `takePending(oauth_token)`
  null → `?discogs=error`; else access token exchange, `/oauth/identity`, `saveConnection`, `kickWorker()`,
  `303 /settings?discogs=connected`. Any Discogs failure → `?discogs=error`, nothing saved.
- **`POST /api/discogs/disconnect`** (session; same-origin): `clearConnection` → `303 /settings?discogs=disconnected`.
- The three routes go through the shared throttle (each is one call; the callback is two).

## Worker

- `kickWorker` and `startWorkerOnBoot` check `discogsAccess(...).kind !== "none"` instead of `missingEnv`.
  `startWorkerOnBoot` always resets claimed rows; the kick does nothing while not connected, so items stay pending.
- The callback route kicks the worker after connecting, so a collection scanned before connecting gets priced.

## Health and config

- `configStatus` reports `discogs: "token" | "connected" | "not-connected" | "setup"` (no secrets, no username) and
  the presence of `DISCOGS_CONSUMER_KEY`/`DISCOGS_CONSUMER_SECRET` in `vars`.
- `ok` is false only for `setup` (and the existing password/session checks): a fresh, unconnected shop app must pass
  Fly's health check on its first deploy.
- Health reads the connection row only to tell `connected` from `not-connected`; a database error keeps today's
  `db: "error"`.

## UI

### Settings: "Discogs account" card (`components/settings/DiscogsCard.tsx`, server component, above Account)

| State | Shows |
|---|---|
| token | "Using a personal access token (`DISCOGS_TOKEN`)." |
| not connected | "Connect your Discogs account so this app can look up records and your seller account's price suggestions. You'll approve it on discogs.com and come straight back." **Connect Discogs** (`<form method="post" action="/api/discogs/connect">`). |
| connected | "Connected as **<username>** since <date>." **Disconnect** (secondary, form POST to `/api/discogs/disconnect`). "To remove this app's access completely, revoke it under Applications in your Discogs settings." linking to discogs.com settings. |
| setup | "Discogs isn't set up for this app (missing consumer key or token)." |

All states say: "This app only reads from Discogs. It doesn't list, buy or message for you." (Phase 15 must revise it.)

`?discogs=` notice (`role="status"`, URL cleaned with `history.replaceState` by a tiny client component):
- `connected`: "Connected as <username>. You're ready to price records." + **Price a record** link.
- `denied`: "You didn't approve the connection, so nothing changed."
- `error`: "Connecting to Discogs didn't work. Try again." (the card's button is right there).
- `disconnected`: "Disconnected. This app no longer uses your Discogs account."

### Elsewhere

- `/` (price a record): when `not-connected`, a card above the form: "Connect your Discogs account to start pricing."
  + **Connect Discogs** (same form). A lookup that returns `not-connected` shows that card instead of an error card.
- Lot page: when `not-connected`, a notice: "Not connected to Discogs: records will be priced once you connect." with a
  Settings link. Scanning and pasting still work.
- Colours only from tokens; 44px buttons; existing contrast and reduced-motion tests apply.

## Setup and runbook

- Owner, once: discogs.com → Settings → Developers → create the application "Mint Condition"; keep the consumer key
  and secret safe.
- `npm run setup:fly -- --app mc-<shop>` asks for the consumer key and secret instead of a token. `planSecrets` sets
  `DISCOGS_CONSUMER_KEY` and `DISCOGS_CONSUMER_SECRET` (and never `DISCOGS_TOKEN`) when `--app` is given; without
  `--app` it asks for a token as today.
- DEPLOY.md §10: the shop's first visit is log in → Connect Discogs; the "never use your token" warning goes.
  `.env.local` with the consumer vars and no token tests the flow on localhost.
- Migration 7 is tested against a local copy of the production database (DEPLOY.md §9) before merging.

## Tests

- **`lib/discogs-oauth.ts`:** RFC 5849 §3.4.1 HMAC-SHA1 example (fixed nonce/timestamp → known signature); query
  parameters signed; RFC 3986 encoding of `!*'()` and spaces; `parseTokenBody` (good, missing secret, junk);
  `callbackUrl` (forwarded https, custom host, localhost http).
- **`discogsAccess`:** token wins over a connection; oauth; not-connected; setup (no consumer vars; no user agent).
- **Store:** save/get/clear; `takePending` once only, wrong token, older than 10 min; cache rows deleted on save and
  clear; migration 7 on an existing database.
- **Routes** (fake fetch): connect → 303 authorize + pending saved; without consumer vars → setup error; callback
  success saves, clears cache, kicks worker, 303 connected; mismatched / expired / `denied` save nothing; all need a
  session; disconnect clears connection and cache.
- **Client:** OAuth header when access is oauth, a new nonce per request; `none` throws not-connected; 401 under OAuth
  → Reconnect message.
- **Lookup routes:** `not-connected` → 409 with the message.
- **Worker:** no kick while not connected; pending items priced after connecting.
- **Health:** ok when not connected; not ok in setup; no secret values or username in the body.
- **`setup:fly`:** `--app` plans consumer vars and no token; without `--app`, a token.
- **UI source checks:** the card's four states and form actions; the Connect card on `/`; the lot notice.

## Done when

On a fresh shop app with consumer keys and no `DISCOGS_TOKEN`: log in, Connect, approve on Discogs, price a record;
Disconnect makes the next lookup show the Connect card; the owner's app keeps working on its token.

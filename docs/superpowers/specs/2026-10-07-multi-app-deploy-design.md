# Multi-app deploy: one image, every shop's app

Date: 2026-10-07 · Status: designed, branch `feat/multi-app-deploy`
Follows version tags (PR #36: `v<base>-alpha.N`, `lib/version.ts`, `scripts/next-version.ts`). First of two
sub-projects for hosting record shops; the second is "Connect Discogs" (OAuth), its own spec.

## Why

The owner wants to host the app for record shops: each shop opens a URL and it works, and the owner ships updates to
every shop by pushing to `main`. Each shop gets its own Fly app (own URL, database, password, Discogs access and
rate limit), all built from this repo.

Success:
- One push to `main` builds one image and deploys it to the owner's app first (the canary), then to every shop app.
- A deploy that breaks the canary never reaches a shop.
- Adding a shop is a documented ~15-minute job, with no code change or commit.

## Decisions (from brainstorming)

- **App list:** a GitHub repo Actions variable `FLY_SHOP_APPS`, not a file. The repo is public and a shop's app name is
  its URL; adding a shop needs no PR.
- **Fly orgs:** one Fly organization per shop: its own bill, its data apart from the owner's, and the org can be
  handed to the shop later. So each shop app has its own deploy token, stored as a repo secret.
- **Build once:** the image is built once in GitHub Actions and pushed to GHCR; every app deploys that image
  (`flyctl deploy --image`). Rejected: a remote build per app (N builds per push, drift, slower rollback) and one
  shared Fly registry (shops in other orgs can't pull from it).
- **Out of scope:** Connect Discogs (next spec), a per-shop currency (`settings.json` currency applies to every app;
  a runtime override would be its own change), staging, and app code changes beyond `setup:fly --app`.

## Pipeline (`.github/workflows/fly-deploy.yml`, pushes to `main` on `garciaryan/mint-condition`)

```
check ──► image ──► canary ──► release
                          └──► shops (one job per FLY_SHOP_APPS entry, parallel)
```

- **`check`**: unchanged (test, typecheck, build); also runs on PRs.
- **`image`** (needs `check`; `permissions: contents: read, packages: write`):
  - checkout with `fetch-depth: 0`; Node 24;
  - `tag` = `scripts/next-version.ts` (unchanged);
  - `shops` = `scripts/shop-apps.ts` (validates `vars.FLY_SHOP_APPS`, prints the JSON list; fails the run on a bad
    value, before anything deploys);
  - log in to `ghcr.io` with `GITHUB_TOKEN`; build the Dockerfile with `--build-arg APP_VERSION=<tag>`; push
    `ghcr.io/garciaryan/mint-condition:<tag>`;
  - outputs `tag`, `image`, `shops`.
- **`canary`** (needs `image`): `flyctl deploy --image <image>` with the existing `FLY_API_TOKEN` (the app in
  `fly.toml`). `flyctl` waits for the `/api/health` check, so a broken image fails here.
- **`release`** (needs `canary`; `permissions: contents: write`): `gh release create <tag> --title <tag> --prerelease
  --generate-notes --target $GITHUB_SHA`, as today. The tag means "this image is live on the canary".
- **`shops`** (needs `image` and `canary`; `if:` the `shops` output isn't `[]`): `strategy.matrix.shop` =
  `fromJSON(needs.image.outputs.shops)`, `fail-fast: false`. Each runs
  `flyctl deploy --image <image> -a ${{ matrix.shop.app }}` with
  `FLY_API_TOKEN: ${{ secrets[matrix.shop.token] }}`. A failed shop keeps its previous version; the run shows red and
  that job can be re-run alone.
- **Concurrency:** workflow-level `group: ${{ github.event_name == 'push' && 'deploy' || github.ref }}`,
  `cancel-in-progress: false`. Push runs queue, so two merges can't take the same tag and deploys never overlap; PR
  runs are unaffected.
- **Config:** every app deploys with the same `fly.toml`; `-a` overrides the app name. A shop's machine stays in the
  region of its volume.
- `--remote-only` is no longer used anywhere.

## `FLY_SHOP_APPS`: `lib/shops.ts` (pure) + `scripts/shop-apps.ts`

```ts
export type ShopApp = { app: string; token: string };
export function parseShopApps(raw: string | undefined, canary: string): ShopApp[];  // throws Error with a message
```

- Unset, empty or whitespace → `[]`.
- Otherwise JSON: an array of `{ app, token }` objects (extra keys refused).
  - `app`: `^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$` (Fly app names); not the canary.
  - `token`: `^[A-Z][A-Z0-9_]*$` (secret names; GitHub reserves the `GITHUB_` prefix, so that's refused too).
  - No app twice.
- Each error names the entry: e.g. `FLY_SHOP_APPS[1].app "MC_Shop" isn't a valid Fly app name`.
- `scripts/shop-apps.ts` reads `process.env.FLY_SHOP_APPS` and the canary name from `fly.toml` (`parseAppName` in
  `lib/setup-fly.ts`), prints `JSON.stringify(list)`, exits 1 with the message on error.

## `npm run setup:fly -- --app <name>`

- `scripts/setup-fly.ts` gains `--app <name>`; without it, the name comes from `fly.toml` as today.
- Pure `appFromArgs(argv: string[], flyToml: string): string` in `lib/setup-fly.ts`: `--app` wins; a name that fails
  the Fly app-name rule throws; no `--app` and no name in `fly.toml` throws.
- Everything else (questions, `fly secrets import` on stdin) is unchanged; the Discogs token is still asked for until
  Connect Discogs ships.

## One-time setup

After the first pipeline run, set the `mint-condition` package on GitHub to **public** (GHCR makes new packages
private, and Fly can't pull a private image without registry credentials). The image holds only public code;
secrets are Fly secrets at runtime.

## Runbook: DEPLOY.md "Hosting a shop"

**Add a shop** (`<shop>` short and lowercase, e.g. `groove`):
1. `fly orgs create mc-<shop>`; add a payment method.
2. `fly apps create mc-<shop> --org mc-<shop>`.
3. `fly volumes create mint_data -a mc-<shop> --region <nearest> --size 1`.
4. `npm run setup:fly -- --app mc-<shop>` (password, user agent; Discogs token until Connect Discogs).
5. `fly tokens create deploy -a mc-<shop> | gh secret set FLY_TOKEN_<SHOP>`.
6. Add `{"app":"mc-<shop>","token":"FLY_TOKEN_<SHOP>"}` to `FLY_SHOP_APPS` (`gh variable set FLY_SHOP_APPS`).
7. First deploy now: `fly deploy --image ghcr.io/garciaryan/mint-condition:<latest tag> -a mc-<shop>`.
8. `curl https://mc-<shop>.fly.dev/api/health` reports that version; log in.

**Roll back one app:** `fly deploy --image ghcr.io/garciaryan/mint-condition:<older tag> -a <app>`; the next push
brings it forward again.

**Remove a shop:** take it out of `FLY_SHOP_APPS`, `gh secret delete FLY_TOKEN_<SHOP>`, then destroy the app or
transfer the org to the shop.

Each app keeps its own database (settings, collections, Discogs cache), password and session secret file.

## Tests

- **`lib/shops.ts`:** unset/empty/`[]` → `[]`; one and several shops; invalid JSON; not an array; an array of strings;
  extra key; bad app name; bad token name; `GITHUB_` token; duplicate app; canary listed. Each error message names the
  entry and field.
- **`lib/setup-fly.ts`:** `--app mc-x` overrides `fly.toml`; no `--app` uses `fly.toml`; bad name throws; neither
  throws.
- **Workflow wiring** (replaces the deploy-job checks in `tests/version.test.ts`): job order (`image` needs `check`,
  `canary` needs `image`, `release` and `shops` need `canary`); `--image` used and `--remote-only` absent;
  `packages: write` on `image`; `gh release create` only in `release`; shops use `secrets[matrix.shop.token]` and
  `fail-fast: false`; workflow-level concurrency with `cancel-in-progress: false`.
- Dockerfile checks unchanged.

## Done when

A push to `main` builds one image `v0.1.0-alpha.N`, deploys the canary, creates the pre-release, and deploys a
throwaway shop app (`mc-test-shop` in its own org, added by following the runbook) from the same image; `/api/health`
on both reports that version. The test shop is then removed with the runbook.

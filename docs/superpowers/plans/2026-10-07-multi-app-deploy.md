# Multi-app Deploy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One push to `main` builds one image, deploys it to the owner's app (canary), tags the release, then deploys the same image to every shop app listed in `FLY_SHOP_APPS`.

**Architecture:** The workflow gains `image` (build + push to GHCR, validate the shop list), `canary`, `release` and a matrix `shops` job; all deploys use `flyctl deploy --image`. Pure validation lives in `lib/shops.ts` (shop list, Fly app names) and `lib/setup-fly.ts` (`--app`), each with a thin script.

**Tech Stack:** GitHub Actions (`docker/login-action`, `docker/build-push-action`), flyctl, Node 24 scripts with `--experimental-strip-types`, Node's test runner.

**Spec:** `docs/superpowers/specs/2026-10-07-multi-app-deploy-design.md`

## Global Constraints

- Branch `feat/multi-app-deploy`. No app code changes beyond `setup:fly --app`. No new npm dependency.
- Image: `ghcr.io/garciaryan/mint-condition:<tag>`, tag from `scripts/next-version.ts` (unchanged).
- Repo variable `FLY_SHOP_APPS`: JSON array of `{ "app", "token" }`; app `^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$`, token `^[A-Z][A-Z0-9_]*$`, not `GITHUB_`-prefixed, no duplicates, not the canary.
- Workflow-level concurrency `group: ${{ github.event_name == 'push' && 'deploy' || github.ref }}`, `cancel-in-progress: false`.
- `--remote-only` appears nowhere; every deploy is `flyctl deploy --image`.
- `lib/` stays pure with relative `.ts` imports; scripts run as `node --experimental-strip-types --no-warnings scripts/<x>.ts`.
- Keep `npm test` and `npm run typecheck` green after each task. Never commit secrets (public repo).

## Review Focus

1. **A shop's token secret is missing or misspelled:** `secrets[...]` is empty and flyctl fails with an opaque auth error. Expect a clear `::error::` naming the secret, only that shop failing. Pinned by a guard step + wiring test (Task 3).
2. **First run, GHCR package still private:** the canary can't pull the image. Expected: canary fails, no shop touched, your app stays on its old version; the runbook says to make the package public and re-run failed jobs. Pinned in the runbook text (Task 3) and the wiring test that shops/release need canary.
3. **Shop volume outside `sjc`:** a first deploy would place the machine in `fly.toml`'s `primary_region` away from its volume. Runbook's first deploy uses `--primary-region <region>` (Task 3).
4. **A canary failure, then a retry push:** the next run recomputes the same `alpha.N` and overwrites that never-released GHCR tag. Acceptable; documented in the runbook (Task 3).
5. **`FLY_SHOP_APPS` unset on a fresh fork/clone:** shops job is skipped, the rest runs. Pinned by `parseShopApps(undefined)` → `[]` (Task 1) and the `if:` wiring test (Task 3).

---

### Task 1: Shop list validation

**Files:**
- Create: `lib/shops.ts`, `scripts/shop-apps.ts`, `tests/shops.test.ts`

**Interfaces:**
- Produces (`lib/shops.ts`):
  - `type ShopApp = { app: string; token: string }`
  - `isFlyAppName(name: string): boolean` — the app regex above.
  - `parseShopApps(raw: string | undefined, canary: string): ShopApp[]` — throws `Error` whose message starts with `FLY_SHOP_APPS` and names the entry and field.
- Produces (`scripts/shop-apps.ts`): prints `JSON.stringify(parseShopApps(process.env.FLY_SHOP_APPS, canary))` where `canary = parseAppName(readFileSync("fly.toml"))` (from `lib/setup-fly.ts`); on error prints the message to stderr and exits 1.

- [ ] **Step 1: Write failing tests** in `tests/shops.test.ts`:
  - `isFlyAppName`: true for `"mint-condition"`, `"mc-groove-records"`, `"a1b"`; false for `"MC_Shop"`, `"-mc"`, `"mc-"`, `"ab"`, `""`, a 64-char name.
  - `parseShopApps(undefined, "mint-condition")`, `("", …)`, `("  ", …)`, `("[]", …)` → `[]`.
  - One and two valid shops round-trip as `{ app, token }` objects in order.
  - Throws (`assert.throws(..., /pattern/)`): `"{"` → `/FLY_SHOP_APPS isn't valid JSON/`; `'{"app":"x"}'` → `/must be a JSON array/`; `'["mc-a"]'` → `/FLY_SHOP_APPS\[0\] must be an object/`; `'[{"app":"mc-a","token":"T","x":1}]'` → `/\[0\] has an unknown key "x"/`; `'[{"app":"MC_A","token":"T"}]'` → `/\[0\]\.app "MC_A" isn't a valid Fly app name/`; token `"t-1"` → `/\[0\]\.token "t-1" isn't a valid secret name/`; token `"GITHUB_X"` → `/\[0\]\.token can't start with GITHUB_/`; two entries `mc-a` → `/\[1\]\.app "mc-a" is listed twice/`; app `"mint-condition"` → `/\[0\]\.app "mint-condition" is the canary/`.
- [ ] **Step 2: Run** `node --experimental-strip-types --no-warnings --test tests/shops.test.ts` — FAIL (module missing).
- [ ] **Step 3: Implement** `lib/shops.ts` and `scripts/shop-apps.ts`.
- [ ] **Step 4: Run** the test — PASS. Then `FLY_SHOP_APPS='[{"app":"mc-test-shop","token":"FLY_TOKEN_TEST"}]' node --experimental-strip-types --no-warnings scripts/shop-apps.ts` prints that list; with `FLY_SHOP_APPS='[{"app":"mint-condition","token":"T"}]'` it exits 1 with the canary message. `npm test`, `npm run typecheck` green.
- [ ] **Step 5: Commit** `feat(deploy): validate the FLY_SHOP_APPS list`

### Task 2: `npm run setup:fly -- --app <name>`

**Files:**
- Modify: `lib/setup-fly.ts`, `scripts/setup-fly.ts`, `tests/setup-fly.test.ts`

**Interfaces:**
- Consumes: `isFlyAppName` (Task 1).
- Produces: `appFromArgs(argv: string[], flyToml: string): string` in `lib/setup-fly.ts` — `--app <name>` wins; else `parseAppName(flyToml)`; throws `Error` for an invalid name (`/isn't a valid Fly app name/`), for `--app` with no value (`/--app needs a name/`), and when there's neither (`/Create the app first/`).

- [ ] **Step 1: Write failing tests** in `tests/setup-fly.test.ts`: `appFromArgs(["--app","mc-x"], "app = 'mint-condition'")` → `"mc-x"`; `appFromArgs([], "app = 'mint-condition'")` → `"mint-condition"`; `["--app","MC_X"]` throws invalid; `["--app"]` throws needs a name; `appFromArgs([], "")` throws create-the-app.
- [ ] **Step 2: Run** `node --experimental-strip-types --no-warnings --test tests/setup-fly.test.ts` — FAIL.
- [ ] **Step 3: Implement** `appFromArgs`; in `scripts/setup-fly.ts` replace the `parseAppName` lookup with `appFromArgs(process.argv.slice(2), toml)` (a thrown message goes to `fail`), keep the "Is the app name in fly.toml right?" message but say "Is the app name right?". Update the header comment and the `package.json`-independent usage note to mention `--app`.
- [ ] **Step 4: Run** the test — PASS; `npm test`, `npm run typecheck` green.
- [ ] **Step 5: Commit** `feat(setup-fly): --app sets another app's secrets`

### Task 3: Pipeline, runbook and docs

**Files:**
- Modify: `.github/workflows/fly-deploy.yml`, `DEPLOY.md` (new "Hosting a shop" section after "Versions and releases"; update "Versions and releases" for GHCR), `CLAUDE.md` (deploy decision line, Layout `lib/shops.ts` + `scripts/shop-apps.ts`, a Status line), `tests/version.test.ts` (remove the old deploy-job test)
- Create: `tests/deploy-workflow.test.ts`

**Interfaces:**
- Consumes: `scripts/next-version.ts` (existing), `scripts/shop-apps.ts` (Task 1).
- Produces: jobs `check`, `image` (outputs `tag`, `image`, `shops`), `canary`, `release`, `shops` per the spec's Pipeline section.

- [ ] **Step 1: Write failing tests** in `tests/deploy-workflow.test.ts` (read the YAML as text; slice per job by its `\n  <name>:` header):
  - Workflow has `concurrency:` with `github.event_name == 'push' && 'deploy' || github.ref` and `cancel-in-progress: false` before `jobs:`.
  - `image` has `needs: check`, `packages: write`, `fetch-depth: 0`, runs `scripts/next-version.ts` and `scripts/shop-apps.ts` (with `FLY_SHOP_APPS: ${{ vars.FLY_SHOP_APPS }}`), uses `docker/build-push-action` with `APP_VERSION=` and `ghcr.io/garciaryan/mint-condition:`.
  - `canary` has `needs: image` and `flyctl deploy --image ${{ needs.image.outputs.image }}`.
  - `release` has `needs: canary`, `contents: write`, and `gh release create "$TAG" --title "$TAG" --prerelease --generate-notes --target "$GITHUB_SHA"`; no other job contains `gh release create`.
  - `shops` needs `[image, canary]`, has `if: needs.image.outputs.shops != '[]'`, `matrix:` with `fromJSON(needs.image.outputs.shops)`, `fail-fast: false`, `secrets[matrix.shop.token]`, a guard printing `::error::` when the token is empty, and `flyctl deploy --image ${{ needs.image.outputs.image }} -a ${{ matrix.shop.app }}`.
  - The whole file has no `--remote-only`; every deploy job has `if: github.event_name == 'push' && github.repository == 'garciaryan/mint-condition'` (directly or via `needs` on `image`, which has it).
  - Remove `tests/version.test.ts`'s "the deploy job tags each successful deploy as a pre-release" (now covered here); keep its Dockerfile and settings tests.
- [ ] **Step 2: Run** `node --experimental-strip-types --no-warnings --test tests/deploy-workflow.test.ts` — FAIL.
- [ ] **Step 3: Rewrite the workflow** per the spec. Pin actions by major version: `docker/login-action@v3` (registry `ghcr.io`, username `${{ github.actor }}`, password `${{ secrets.GITHUB_TOKEN }}`), `docker/setup-buildx-action@v3`, `docker/build-push-action@v6` (`push: true`, `tags: <image>`, `build-args: APP_VERSION=<tag>`). Job outputs via `$GITHUB_OUTPUT`. Shop token guard step: `if [ -z "$FLY_API_TOKEN" ]; then echo "::error::Secret ${{ matrix.shop.token }} for ${{ matrix.shop.app }} isn't set"; exit 1; fi`. Update the header comment.
- [ ] **Step 4: Run** the test — PASS; `npm test`, `npm run typecheck` green; parse the YAML with `ruby -ryaml -e 'p YAML.load_file(".github/workflows/fly-deploy.yml")["jobs"].keys'` → `["check", "image", "canary", "release", "shops"]`.
- [ ] **Step 5: Docs.** DEPLOY.md "Hosting a shop": the spec's runbook steps verbatim in intent, with step 7 as `fly deploy --image ghcr.io/garciaryan/mint-condition:<latest tag> -a mc-<shop> --primary-region <region>`; the one-time "make the package public" step, noting the first run's canary will fail to pull until then (make it public, then "Re-run failed jobs"); rollback; removal; the note that a failed canary's `alpha.N` is reused by the next run. "Versions and releases": tags now also name a GHCR image. CLAUDE.md: update the "Every push to `main` deploys" decision line (image → canary → release → shops, `FLY_SHOP_APPS`), Layout entries, Status line ("Multi-app deploy (2026-10-07): built on feat/multi-app-deploy; N tests; …").
- [ ] **Step 6: Run** `npm test` (docs tests included) and `npm run typecheck` — green.
- [ ] **Step 7: Commit** `feat(deploy): build once to GHCR, deploy canary then every shop app`

### Task 4: Live check (after merge, with the owner)

Pushes to `main` and Fly org/app creation are the owner's actions; do these with them, not alone.

- [ ] **Step 1:** After the PR merges, watch the run: `image` pushes `v0.1.0-alpha.N`; `canary` fails to pull (package private); make the package public; re-run failed jobs; `canary`, `release` pass; `shops` skipped (`FLY_SHOP_APPS` unset).
- [ ] **Step 2:** Follow the DEPLOY.md runbook to add `mc-test-shop` in its own org; set `FLY_SHOP_APPS`; first deploy by image.
- [ ] **Step 3:** Push a docs-only change; confirm both apps' `/api/health` report the same new version.
- [ ] **Step 4:** Remove `mc-test-shop` with the runbook; record the result in the spec's Status line and commit.

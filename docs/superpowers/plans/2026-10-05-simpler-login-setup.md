# Simpler Login Setup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Self-hosters set one password (`APP_PASSWORD`), the session secret makes itself, and `npm run setup:fly` sets every Fly secret.

**Architecture:** `authMode` (pure, `lib/auth.ts`) learns a plain-password source and returns a message for every misconfiguration; a boot step (`lib/session-secret.ts`, called from `instrumentation.ts`) fills `process.env.SESSION_SECRET` from a generated file on the data volume when it isn't set; an interactive script (`scripts/setup-fly.ts`, pure logic in `lib/setup-fly.ts`) pipes secrets to `fly secrets import`. README gets a full "Get started".

**Tech Stack:** Next.js 15 (nodejs middleware), TypeScript run by Node 22 `--experimental-strip-types`, `node:test`, `node:crypto`, `node:fs`, `node:child_process`, flyctl.

**Spec:** `docs/superpowers/specs/2026-10-05-simpler-login-setup-design.md`

## Global Constraints

- No new runtime or dev dependencies.
- `lib/auth.ts` and `lib/gate.ts` stay Web-Crypto-only (no `node:` imports); node crypto lives in `lib/password.ts`.
- Minimum password length: 12 characters (same as `hash-password`).
- Existing `APP_PASSWORD_HASH` + `SESSION_SECRET` deploys keep working unchanged; `SESSION_SECRET` in the environment always wins over the file.
- Secret values are never printed, logged, put in argv, or returned by `/api/health` (booleans and the source only).
- Session secret file: `<DATA_DIR>/session-secret` (`DATA_DIR` default `./data`), 32 random bytes base64, mode `0o600`, created with flag `"wx"`.
- Exact messages: `Set only one of APP_PASSWORD and APP_PASSWORD_HASH.` · `APP_PASSWORD must be at least 12 characters.` · missing vars keep today's `Login not configured: missing A and B`.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Keep `npm test` and `npm run typecheck` green after every task.

## Review Focus

1. `APP_PASSWORD` with surrounding spaces in `.env.local` or a Fly secret: trimmed before use and before the length check (test in Task 1).
2. First boot where `DATA_DIR` does not exist yet (fresh clone, fresh volume): the directory is created and the file written (test in Task 2).
3. The owner's existing prod (`APP_PASSWORD_HASH` + `SESSION_SECRET` set): no file is created and nothing changes (test in Task 2).
4. Re-running `setup:fly` and pressing Enter at every prompt: nothing is imported or unset, and it says so (test in Task 3).
5. Passwords with `=`, `$`, spaces or a leading/trailing `"`: `=`/`$`/spaces pass through the import line verbatim; a leading or trailing quote or a newline is rejected at the prompt, since the import format may strip quotes (tests in Task 3).

---

### Task 1: Plain-password login and the new auth modes

**Files:**
- Modify: `lib/auth.ts` (`AuthMode`, `authMode`, `configStatus`)
- Modify: `lib/password.ts` (add `checkPassword`)
- Modify: `app/api/login/route.ts`, `lib/gate.ts`, `lib/route-auth.ts` (use `auth.message`, `checkPassword`)
- Modify: `middleware.ts` (warning text: `Login is disabled: APP_PASSWORD is unset.`)
- Test: `tests/auth.test.ts`, `tests/gate.test.ts`, `tests/login.test.ts`

**Interfaces:**
- Produces:
  - `type LoginPassword = { kind: "plain"; value: string } | { kind: "hash"; value: string }`
  - `type AuthMode = { mode: "off" } | { mode: "on"; secret: string; password: LoginPassword } | { mode: "misconfigured"; missing: string[]; message: string }`
  - `authMode(env): AuthMode` per the spec §1 table. `missing` is `[]` for the both-set and too-short cases; otherwise `message` is `Login not configured: missing ${missing.join(" and ")}`. Password-less production lists `["APP_PASSWORD"]` (plus `"SESSION_SECRET"` only if a password is set without one).
  - `checkPassword(input: string, password: LoginPassword): boolean` in `lib/password.ts`.
  - `configStatus(env)` returns `{ ok, vars: { DISCOGS_TOKEN, DISCOGS_USER_AGENT, APP_PASSWORD, APP_PASSWORD_HASH, SESSION_SECRET: boolean }, sessionSecretSource: "env" | "file" | null }`; source is `"file"` when `env.SESSION_SECRET_SOURCE === "file"` (set by Task 2), `"env"` when `SESSION_SECRET` is set otherwise, else `null`.

- [ ] **Step 1: Write the failing tests** in `tests/auth.test.ts` (replace the `authMode` and `configStatus` tests):

```ts
test("authMode: password sources, both-set, length, missing", () => {
  assert.deepEqual(authMode({}), { mode: "off" });
  assert.deepEqual(authMode({ APP_PASSWORD: "  twelve chars ok  ", SESSION_SECRET: "s" }),
    { mode: "on", secret: "s", password: { kind: "plain", value: "twelve chars ok" } });
  assert.deepEqual(authMode({ APP_PASSWORD_HASH: "h", SESSION_SECRET: "s" }),
    { mode: "on", secret: "s", password: { kind: "hash", value: "h" } });
  const both = authMode({ APP_PASSWORD: "twelve chars ok", APP_PASSWORD_HASH: "h", SESSION_SECRET: "s" });
  assert.equal(both.mode === "misconfigured" && both.message, "Set only one of APP_PASSWORD and APP_PASSWORD_HASH.");
  const short = authMode({ APP_PASSWORD: " eleven char ", SESSION_SECRET: "s" }); // 11 after trim
  assert.equal(short.mode === "misconfigured" && short.message, "APP_PASSWORD must be at least 12 characters.");
  assert.deepEqual(authMode({ NODE_ENV: "production" }),
    { mode: "misconfigured", missing: ["APP_PASSWORD"], message: "Login not configured: missing APP_PASSWORD" });
  assert.deepEqual(authMode({ SESSION_SECRET: "s" }),
    { mode: "misconfigured", missing: ["APP_PASSWORD"], message: "Login not configured: missing APP_PASSWORD" });
  assert.deepEqual(authMode({ APP_PASSWORD: "twelve chars ok" }),
    { mode: "misconfigured", missing: ["SESSION_SECRET"], message: "Login not configured: missing SESSION_SECRET" });
});

test("checkPassword: plain compares exactly, hash uses scrypt", () => {
  assert.equal(checkPassword("twelve chars ok", { kind: "plain", value: "twelve chars ok" }), true);
  assert.equal(checkPassword("twelve chars oK", { kind: "plain", value: "twelve chars ok" }), false);
  assert.equal(checkPassword("short", { kind: "plain", value: "twelve chars ok" }), false);
  const h = hashPassword("right password 1");
  assert.equal(checkPassword("right password 1", { kind: "hash", value: h }), true);
  assert.equal(checkPassword("wrong password 1", { kind: "hash", value: h }), false);
  assert.equal(checkPassword("x", { kind: "hash", value: "not-a-hash" }), false);
});

test("configStatus reports presence and the secret's source, never values", () => {
  const s = configStatus({ DISCOGS_TOKEN: "t", DISCOGS_USER_AGENT: "u", APP_PASSWORD: "twelve chars ok", SESSION_SECRET: "zzz", SESSION_SECRET_SOURCE: "file" });
  assert.deepEqual(s, { ok: true, vars: { DISCOGS_TOKEN: true, DISCOGS_USER_AGENT: true, APP_PASSWORD: true, APP_PASSWORD_HASH: false, SESSION_SECRET: true }, sessionSecretSource: "file" });
  assert.doesNotMatch(JSON.stringify(s), /twelve|zzz/);
  assert.equal(configStatus({ DISCOGS_TOKEN: "t", DISCOGS_USER_AGENT: "u" }).sessionSecretSource, null);
});
```

In `tests/gate.test.ts`: the misconfigured test's both-missing text becomes the `{ NODE_ENV: "production" }` case → `"Login not configured: missing APP_PASSWORD"`, and add `{ APP_PASSWORD: "x", APP_PASSWORD_HASH: "h", SESSION_SECRET: "s" }` → API JSON 503 with message `Set only one of APP_PASSWORD and APP_PASSWORD_HASH.`. In `tests/login.test.ts`: rename "production without APP_PASSWORD_HASH" expectations to the new message, and add `test("APP_PASSWORD (plain) logs in; wrong is 401")` that sets `APP_PASSWORD="plain password 12"`, deletes `APP_PASSWORD_HASH` for the test and restores it after.

- [ ] **Step 2: Run** `npm test` — Expected: the new auth/gate/login tests FAIL (`checkPassword` not exported, old shapes).
- [ ] **Step 3: Implement** the Interfaces above in `lib/auth.ts` and `lib/password.ts`. `checkPassword` plain: `timingSafeEqual(sha256(input), sha256(value))`. Callers: gate, login route and `requireSession` return `auth.message` instead of building the text; the login route calls `checkPassword(password, auth.password)`; update the login route's comment that names `verifyPassword`.
- [ ] **Step 4: Run** `npm test && npm run typecheck` — Expected: all pass.
- [ ] **Step 5: Commit** `feat(auth): accept a plain APP_PASSWORD alongside APP_PASSWORD_HASH`

### Task 2: Generated session secret at boot

**Files:**
- Create: `lib/session-secret.ts`
- Modify: `instrumentation.ts`
- Test: `tests/session-secret.test.ts`

**Interfaces:**
- Consumes: env var names from Task 1.
- Produces: `ensureSessionSecret(env: Record<string, string | undefined>, dataDir: string): "env" | "file" | null` — mutates `env` (`SESSION_SECRET`, `SESSION_SECRET_SOURCE = "file"`) only in the file case; returns the source. No password set (`APP_PASSWORD` and `APP_PASSWORD_HASH` both blank) → `null`, no file. `SESSION_SECRET` set → `"env"`, no file. Throws `Error` whose message contains the file path and `delete it to make a new one` when the file exists but is empty after trim.

- [ ] **Step 1: Write the failing tests** (each in a fresh `mkdtempSync` dir; `dataDir` points at a not-yet-existing child to cover Review Focus 2):
  - `"no password: nothing happens"` → returns `null`, dir not created.
  - `"SESSION_SECRET in env wins and no file is written"` with `{ APP_PASSWORD_HASH: "h", SESSION_SECRET: "s" }` → `"env"`, file absent, env unchanged (Review Focus 3).
  - `"creates a 0600 secret once and reuses it"` → first call `"file"`, `env.SESSION_SECRET` decodes (base64) to 32 bytes, `statSync(file).mode & 0o777 === 0o600`; a second call with a fresh env object yields the same secret.
  - `"an empty file stops startup with the path"` → write `""`, `assert.throws(..., /session-secret.*delete it to make a new one/)`.
- [ ] **Step 2: Run** `npm test` — Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `ensureSessionSecret`: `mkdirSync(dataDir, { recursive: true })`; try `writeFileSync(file, randomBytes(32).toString("base64"), { flag: "wx", mode: 0o600 })`, on `EEXIST` fall through to read; read, trim, throw if empty. In `instrumentation.ts` (nodejs branch), call it first with `process.env` and `process.env.DATA_DIR ?? "./data"`, before starting the worker.
- [ ] **Step 4: Run** `npm test && npm run typecheck` — Expected: pass.
- [ ] **Step 5: Manual check:** `rm -rf data/tmp-auth && DATA_DIR=data/tmp-auth APP_PASSWORD="local test password" NODE_ENV=production npm run build && DATA_DIR=data/tmp-auth APP_PASSWORD="local test password" npm start` (stop any running `next dev` first — builds clobber its `.next`; restart it afterwards). Expected: `data/tmp-auth/session-secret` exists with mode 600; `/login` accepts the password; restarting keeps the session; `/api/health` shows `"sessionSecretSource":"file"`. Delete `data/tmp-auth` after.
- [ ] **Step 6: Commit** `feat(auth): generate the session secret on the data volume when SESSION_SECRET is unset`

### Task 3: `npm run setup:fly`

**Files:**
- Create: `lib/setup-fly.ts` (pure), `scripts/setup-fly.ts`, `scripts/prompt.ts`
- Modify: `scripts/hash-password.ts` (use `scripts/prompt.ts`), `package.json` (`"setup:fly": "node --experimental-strip-types --no-warnings scripts/setup-fly.ts"`)
- Test: `tests/setup-fly.test.ts`

**Interfaces:**
- Produces (`lib/setup-fly.ts`):
  - `parseAppName(flyToml: string): string | null` — `app = "name"` or `app = 'name'` at line start.
  - `parseSecretNames(json: string): string[]` — array items' `Name ?? name`; invalid JSON → `[]`.
  - `secretValueError(value: string): string | null` — newline → `"Must be one line."`; leading or trailing `"` or `'` → `"Can't start or end with a quote."`.
  - `passwordError(first: string, second: string): string | null` — `"Passwords do not match."`, `"Password must be at least 12 characters."`, else `secretValueError(first)`.
  - `defaultUserAgent(contact: string): string` → `MintCondition/0.1 (+${contact})`.
  - `type Answers = { token?: string; userAgent?: string; password?: string }` (undefined = keep current).
  - `planSecrets(current: string[], answers: Answers): { importText: string; set: string[]; unset: string[] }` — lines `DISCOGS_TOKEN=…`, `DISCOGS_USER_AGENT=…`, `APP_PASSWORD=…` for defined answers, joined with `\n` plus trailing `\n` (empty string when none); `unset` is `["APP_PASSWORD_HASH"]` when `password` is defined and `current` includes it.
  - `scripts/prompt.ts`: `ask(question: string, opts?: { hidden?: boolean }): Promise<string>` and `closePrompt(): void` (hidden mode = today's muted-readline approach from `hash-password.ts`).

- [ ] **Step 1: Write the failing tests:**

```ts
test("parseAppName and parseSecretNames", () => {
  assert.equal(parseAppName('# x\napp = "mint-condition"\nprimary_region = "sjc"'), "mint-condition");
  assert.equal(parseAppName("app = 'my-app'"), "my-app");
  assert.equal(parseAppName("primary_region = 'sjc'"), null);
  assert.deepEqual(parseSecretNames('[{"Name":"DISCOGS_TOKEN"},{"name":"APP_PASSWORD_HASH"}]'), ["DISCOGS_TOKEN", "APP_PASSWORD_HASH"]);
  assert.deepEqual(parseSecretNames("not json"), []);
});

test("password and value checks", () => {
  assert.equal(passwordError("twelve chars ok", "twelve chars oK"), "Passwords do not match.");
  assert.equal(passwordError("eleven char", "eleven char"), "Password must be at least 12 characters.");
  assert.equal(passwordError('"quoted pass 12"', '"quoted pass 12"'), "Can't start or end with a quote.");
  assert.equal(passwordError("a=b $c d e f g", "a=b $c d e f g"), null);
  assert.equal(secretValueError("two\nlines"), "Must be one line.");
});

test("planSecrets builds import lines and drops the old hash", () => {
  assert.deepEqual(planSecrets(["DISCOGS_TOKEN"], {}), { importText: "", set: [], unset: [] });
  assert.deepEqual(planSecrets(["APP_PASSWORD_HASH"], { password: "a=b $c d e f g", userAgent: "MintCondition/0.1 (+me@x.com)" }), {
    importText: "DISCOGS_USER_AGENT=MintCondition/0.1 (+me@x.com)\nAPP_PASSWORD=a=b $c d e f g\n",
    set: ["DISCOGS_USER_AGENT", "APP_PASSWORD"],
    unset: ["APP_PASSWORD_HASH"],
  });
  assert.equal(defaultUserAgent("me@x.com"), "MintCondition/0.1 (+me@x.com)");
});
```

- [ ] **Step 2: Run** `npm test` — Expected: FAIL (module missing).
- [ ] **Step 3: Implement `lib/setup-fly.ts`** per Interfaces.
- [ ] **Step 4: Implement `scripts/prompt.ts`** and switch `scripts/hash-password.ts` to it (behaviour unchanged; it still prints the hash, and its last line now says `Or skip hashing: set APP_PASSWORD instead (see README).` instead of the openssl hint).
- [ ] **Step 5: Implement `scripts/setup-fly.ts`:** not a TTY → exit 1 with `Run this in a terminal.`; find `fly`, else `flyctl` (`spawnSync(bin, ["version"])`), else exit 1 with the install link `https://fly.io/docs/flyctl/install/`; `fly auth whoami` fails → `Log in first: fly auth login`; read `fly.toml` → `parseAppName`, null → `Create the app first: fly launch --copy-config --no-deploy`; `fly secrets list -a <app> --json` → `parseSecretNames`. Prompts: token (hidden; Enter keeps when `DISCOGS_TOKEN` is current, otherwise re-ask), contact for the user agent (visible; Enter keeps when current) → `defaultUserAgent`, password twice (hidden; Enter keeps when either password secret is current; on `passwordError` print it and re-ask). Re-ask on any `secretValueError`. `planSecrets`; nothing to do → print `Nothing changed.` and exit 0. Otherwise `spawnSync(bin, ["secrets", "import", "-a", app], { input: importText, stdio: ["pipe", "inherit", "inherit"] })`; non-zero → exit 1 without unsetting; then `secrets unset <names> -a <app>` if `unset` is non-empty. Print `Set: <names>` / `Removed: <names>` and `Next: fly deploy --ha=false (first deploy only; setting secrets restarts a running app).`. Never print values.
- [ ] **Step 6: Run** `npm test && npm run typecheck` — Expected: pass. Then `npm run setup:fly < /dev/null` — Expected: `Run this in a terminal.`, exit 1.
- [ ] **Step 7: Commit** `feat: npm run setup:fly sets the Fly secrets without typing fly secrets`

### Task 4: Docs — README "Get started", DEPLOY.md, .env.example, CLAUDE.md

**Files:**
- Modify: `README.md` (replace "Requirements", "Run it on your computer", "Run it on Fly.io" with `## Get started`; update the "Ways to run it" table's Setup/Login rows and the Development command list to include `npm run setup:fly`)
- Modify: `DEPLOY.md` (§3 Secrets, the auth-modes paragraph, password change and secret rotation sections, the local tunnel note at line ~214)
- Modify: `.env.example`, `CLAUDE.md`
- Test: `tests/footer.test.ts` is unaffected; add `tests/docs.test.ts`

**Interfaces:**
- Consumes: commands and file names from Tasks 1–3 (`APP_PASSWORD`, `DATA_DIR/session-secret`, `npm run setup:fly`).

- [ ] **Step 1: Write the failing test** `tests/docs.test.ts`:

```ts
test("README Get started covers both ways with the setup script, and no longer needs openssl", () => {
  const readme = readFileSync("README.md", "utf8");
  const start = readme.slice(readme.indexOf("## Get started"), readme.indexOf("\n## ", readme.indexOf("## Get started") + 1));
  for (const s of ["npm install", "cp .env.example .env.local", "npm run dev", "fly auth login",
    "fly launch --copy-config --no-deploy", "fly volumes create mint_data", "npm run setup:fly", "fly deploy --ha=false"]) {
    assert.ok(start.includes(s), s);
  }
  assert.doesNotMatch(readme, /openssl rand/);
  assert.match(readFileSync(".env.example", "utf8"), /^# APP_PASSWORD=/m);
});
```

- [ ] **Step 2: Run** `npm test` — Expected: FAIL.
- [ ] **Step 3: Write README `## Get started`** per spec §4, as numbered steps with the exact commands, under `### What you need`, `### On your computer`, `### On Fly.io` (including `### If something goes wrong`: open `https://<app>.fly.dev/api/health`, which names missing settings; and `### Changing the password`: re-run `npm run setup:fly`). Keep the one-machine warning and the fork/GitHub Actions note. Link to DEPLOY.md for logs, backups and smoke checks.
- [ ] **Step 4: Update DEPLOY.md** §3 to `npm run setup:fly` first, then a "By hand" fallback (`fly secrets set` with `APP_PASSWORD`, and the `APP_PASSWORD_HASH` route via `npm run hash-password`); auth modes per spec §1; rotation: delete `/data/session-secret` and restart, or set `SESSION_SECRET`. `.env.example`: add `# Optional: set to require a login locally (min 12 characters).` and `# APP_PASSWORD=`. CLAUDE.md: the auth decision line (`APP_PASSWORD` or `APP_PASSWORD_HASH`, generated `SESSION_SECRET` file, `npm run setup:fly`) and the Layout list (`lib/session-secret.ts`, `lib/setup-fly.ts`, `scripts/setup-fly.ts`, `scripts/prompt.ts`) and the Commands list.
- [ ] **Step 5: Run** `npm test && npm run typecheck` — Expected: pass. `grep -n "openssl\|APP_PASSWORD_HASH" README.md DEPLOY.md` — Expected: only the documented fallback and existing-deploy mentions.
- [ ] **Step 6: Commit** `docs: Get started with npm run setup:fly and APP_PASSWORD`

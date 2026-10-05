# Settings UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Edit every pricing/offer tunable from a `/settings` page; saved values live in SQLite and take effect on the next request.

**Architecture:** Migration 3 adds a one-row `settings` table. `lib/settings-store.ts` layers the saved row over
`settings.json` defaults (pure `mergeSettings` + existing `parseSettings`) and every route reads settings through it.
A pure, client-safe `lib/settings-form.ts` converts between `Settings` and form strings (multipliers as percents) and
checks fields; `app/settings/SettingsForm.tsx` renders the form against `/api/settings` (GET/PUT/DELETE).

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, `node:sqlite`, Node's built-in test runner.

**Spec:** `docs/superpowers/specs/2026-10-04-settings-ui-design.md`

## Global Constraints

- No new dependencies. Tests use `node:test` + `node:assert/strict`, files in `tests/*.test.ts`.
- `lib/pricing.ts` and `lib/offer.ts` are not modified.
- Migrations are append-only: never edit migrations 1 or 2.
- `discogs.currency` and `local.regionMultipliers` are never written to the saved row; `discogs.cacheHours` is not on the page (phase 6b).
- Every `/api/settings` handler starts with `requireSession(request)`; body limit `MAX_BODY` (64 KB).
- UI: visible label on every field, 16px inputs, 44px controls, `aria-describedby` for hints/errors, status live region, works at 375px.
- Copy, verbatim: save status "Saved. Prices and lots use these now."; invalid banner "Your saved settings no longer pass a check (<reason>). Prices are using the defaults until you fix and save, or reset."; currency "<CUR> (follows your Discogs seller account)"; default hint "Default: <value>".
- Keep `npm test` and `npm run typecheck` green after every task.
- Single test file: `node --experimental-strip-types --no-warnings --test tests/<file>.test.ts`

## Review Focus

1. A PUT with a number sent as a string (`"0.8"`) or `null` → 400 naming the field, nothing stored. Today `parseSettings` doesn't type-check the `local.*` fields, so `"0.8"` would pass and be saved. (Task 2 tightens it; Task 6 tests the route.)
2. A form field left empty → "Enter a number" error, never saved as 0 (`Number("") === 0`). (Task 5.)
3. The saved row is corrupt JSON or not an object → defaults plus `invalid`; lookups and lots keep working. (Task 3.)
4. The ladder is edited so it no longer contains the current opening % (e.g. `30, 50, 60` with opening 40) → an error on the opening field, not a 500 on save. (Task 5.)
5. Float noise in the percent round-trip: `0.95` shows as `"95"` (not `95.00000000000001`) and `"95.5"` saves as `0.955`. (Task 5.)

---

### Task 1: Migration 3 (`settings` table)

**Files:**
- Modify: `lib/migrations.ts` (append a third string to `migrations`)
- Test: `tests/db.test.ts`

**Interfaces:**
- Produces: table `settings(id INTEGER PRIMARY KEY CHECK (id = 1), json TEXT NOT NULL, updated_at INTEGER NOT NULL)`.

- [ ] **Step 1: Write the failing test** in `tests/db.test.ts`

```ts
test("migration 3 adds a one-row settings table to a version-2 database", () => {
  const db = new DatabaseSync(":memory:");
  migrate(db, migrations.slice(0, 2));
  assert.equal(migrate(db, migrations), 3);
  db.exec("insert into settings (id, json, updated_at) values (1, '{}', 1)");
  assert.throws(() => db.exec("insert into settings (id, json, updated_at) values (2, '{}', 1)"), /CHECK/);
});
```

- [ ] **Step 2: Run it, expect FAIL** (`no such table: settings` / version 2): `node --experimental-strip-types --no-warnings --test tests/db.test.ts`
- [ ] **Step 3: Append the migration** using the exact SQL from the spec's Data section.
- [ ] **Step 4: Run `npm test`, expect PASS** (other tests that compare to `migrations.length` still pass).
- [ ] **Step 5: Commit** `feat(db): migration 3 adds settings table`

---

### Task 2: `mergeSettings`, stricter validation, error-field helper

**Files:**
- Modify: `lib/settings.ts`
- Test: `tests/settings.test.ts`

**Interfaces:**
- Produces:
  - `mergeSettings(defaults: Settings, saved: unknown): unknown`
  - `settingsErrorPath(message: string): string | null` — returns the dotted path after `"settings: "` (allowing `+` in the key, e.g. `sleeveMultipliers.VG+`), else `null`.
  - `parseSettings` now rejects non-number `local.*` fields with one message per field.

- [ ] **Step 1: Write the failing tests**

```ts
const base = settings; // already parsed from settings.json at the top of the file

test("mergeSettings overrides nested values and keeps unsaved defaults", () => {
  const m = mergeSettings(base, { sell: { undercutPercent: 5 } }) as Settings;
  assert.equal(m.sell.undercutPercent, 5);
  assert.equal(m.sell.floor, base.sell.floor);
  assert.deepEqual(m.offer, base.offer);
});

test("mergeSettings replaces arrays whole and drops saved-only keys", () => {
  const m = mergeSettings(base, { offer: { ladderPercents: [50] }, gone: 1, sell: { old: 2 } }) as Record<string, any>;
  assert.deepEqual(m.offer.ladderPercents, [50]);
  assert.equal("gone" in m, false);
  assert.equal("old" in m.sell, false);
});

test("mergeSettings treats a non-object saved value as nothing saved", () => {
  assert.deepEqual(mergeSettings(base, null), base);
  assert.deepEqual(mergeSettings(base, [1, 2]), base);
  assert.deepEqual(mergeSettings(base, "x"), base);
});

test("local fields must be numbers and errors name the field", () => {
  const withLocal = (l: object) => ({ ...base, local: { ...base.local, ...l } });
  assert.throws(() => parseSettings(withLocal({ localDiscountMultiplier: "0.8" })), /local\.localDiscountMultiplier/);
  assert.throws(() => parseSettings(withLocal({ defaultRegionMultiplier: 0 })), /local\.defaultRegionMultiplier/);
  assert.throws(() => parseSettings(withLocal({ discogsFeePercent: null })), /local\.discogsFeePercent/);
});

test("settingsErrorPath extracts the dotted path", () => {
  assert.equal(settingsErrorPath("settings: sleeveMultipliers.VG+ must be a number in (0, 1.5]"), "sleeveMultipliers.VG+");
  assert.equal(settingsErrorPath("settings: offer.openingPercent must be one of offer.ladderPercents"), "offer.openingPercent");
  assert.equal(settingsErrorPath("settings: expected an object"), null);
  assert.equal(settingsErrorPath("boom"), null);
});
```

- [ ] **Step 2: Run, expect FAIL** (functions not exported).
- [ ] **Step 3: Implement.** In `mergeSettings`, recurse only when both sides are plain objects (not arrays); for a key the saved side lacks, use the default. In `parseSettings`, replace the combined `local` check with per-field `isNum` checks (`local.localDiscountMultiplier > 0`, `local.defaultRegionMultiplier > 0`, `local.discogsFeePercent` in [0, 100)) and add `isNum` to `sell.undercutPercent`, `sell.floor`. `settingsErrorPath`: `/^settings: ([A-Za-z]+(?:\.[A-Za-z+]+)+)(?=\s|$)/` (no `\b`: it fails after `VG+`); return `null` for `settings: expected an object`.
- [ ] **Step 4: Run `npm test`, expect PASS.**
- [ ] **Step 5: Commit** `feat(settings): mergeSettings, per-field local checks, error path helper`

---

### Task 3: `lib/settings-store.ts`

**Files:**
- Create: `lib/settings-store.ts`
- Test: `tests/settings-store.test.ts`

**Interfaces:**
- Consumes: `loadSettings`, `parseSettings`, `mergeSettings` (Task 2); `openDb` from `lib/db.ts`.
- Produces:
  ```ts
  export type SettingsState = {
    settings: Settings; defaults: Settings; saved: boolean; updatedAt: number | null; invalid: string | null;
  };
  export function getSettings(db: DatabaseSync, defaultsPath?: string): SettingsState;
  export function getSavedRaw(db: DatabaseSync): unknown | null;   // parsed JSON, or the raw string if it won't parse
  export function saveSettings(db: DatabaseSync, input: unknown, defaultsPath?: string, now?: number): Settings;
  export function resetSettings(db: DatabaseSync): void;
  export function settingsPath(): string | undefined;               // current defaults-path override
  export function __setSettingsPathForTests(path: string | null): void;
  ```
  `getSettings`/`saveSettings` use `defaultsPath ?? settingsPath()`. (`getSettings` also returns `defaults` so the route doesn't read the file twice.)

- [ ] **Step 1: Write the failing tests** (each test uses `openDb(":memory:")`; `defaults = loadSettings()`)

```ts
test("no row gives the defaults", () => {
  const s = getSettings(db);
  assert.deepEqual(s.settings, defaults);
  assert.equal(s.saved, false); assert.equal(s.updatedAt, null); assert.equal(s.invalid, null);
});

test("save then get round-trips; reset brings defaults back", () => {
  const out = saveSettings(db, { ...defaults, offer: { ...defaults.offer, marginPercent: 35 } }, undefined, 1000);
  assert.equal(out.offer.marginPercent, 35);
  const s = getSettings(db);
  assert.equal(s.settings.offer.marginPercent, 35);
  assert.equal(s.saved, true); assert.equal(s.updatedAt, 1000);
  resetSettings(db);
  assert.deepEqual(getSettings(db).settings, defaults);
});

test("an invalid save throws and leaves the stored row unchanged", () => {
  saveSettings(db, { offer: { marginPercent: 35 } });
  assert.throws(() => saveSettings(db, { offer: { marginPercent: 100 } }), /marginPercent/);
  assert.equal(getSettings(db).settings.offer.marginPercent, 35);
});

test("currency and region multipliers are never stored", () => {
  saveSettings(db, { discogs: { currency: "EUR" }, local: { regionMultipliers: { "415": 2 } } });
  const raw = getSavedRaw(db) as Record<string, any>;
  assert.equal(raw.discogs?.currency, undefined);
  assert.equal(raw.local?.regionMultipliers, undefined);
  assert.equal(getSettings(db).settings.discogs.currency, defaults.discogs.currency);
});

test("a stored row that no longer validates falls back to defaults with a reason", () => {
  db.prepare("insert into settings (id, json, updated_at) values (1, ?, 5)").run(JSON.stringify({ offer: { openingPercent: 45 } }));
  const s = getSettings(db);
  assert.deepEqual(s.settings, defaults);
  assert.equal(s.saved, true);
  assert.match(s.invalid ?? "", /openingPercent/);
});

test("corrupt JSON in the row falls back to defaults with a reason", () => {
  db.prepare("insert into settings (id, json, updated_at) values (1, '{not json', 5)").run();
  const s = getSettings(db);
  assert.deepEqual(s.settings, defaults);
  assert.ok(s.invalid);
});

test("an invalid settings.json still throws", () => {
  assert.throws(() => getSettings(db, "/nonexistent/settings.json"));
});
```

- [ ] **Step 2: Run, expect FAIL** (module missing).
- [ ] **Step 3: Implement.** `saveSettings`: `parseSettings(mergeSettings(defaults, input))`, then `structuredClone` it, delete `discogs.currency` and `local.regionMultipliers`, upsert with `INSERT ... ON CONFLICT(id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at`. `now` defaults to `Date.now()`. `getSettings` catches only row parse/validation errors; errors from loading `settings.json` propagate.
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** `feat(settings): SQLite-backed settings store over settings.json defaults`

---

### Task 4: Routes read settings from the store

**Files:**
- Modify: `lib/collection/http.ts` (`withSettings`; remove the local `settingsPath` variable and re-export `__setSettingsPathForTests` from `lib/settings-store.ts`)
- Modify: `app/api/lookup/route.ts` (replace `loadSettings()` with `getSettings(getDb()).settings`, same try/catch and 500 message)
- Test: `tests/collection-routes.test.ts`, `tests/lookup-route.test.ts`

**Interfaces:**
- Consumes: `getSettings`, `saveSettings`, `__setSettingsPathForTests` (Task 3).
- Produces: no new exports; `withSettings` keeps its signature and its 500 `kind: "settings"` response.

- [ ] **Step 1: Write the failing test** in `tests/collection-routes.test.ts` (reuse its `newLot` helper and `SUG`)

```ts
test("a saved setting changes lot prices on the next read", async () => {
  const { body: lot } = await newLot();   // defaults: record VG+, sleeve VG
  await addItems(req("POST", { lines: [{ query: "A" }], record: "VG+", sleeve: "VG" }), ctx(String(lot.id)));
  // poll getSession until totals.priced === 1 (2 s deadline, 10 ms sleep), as the worker test at ~line 289 does
  const before = (await j(await getSession(req("GET"), ctx(String(lot.id))))).totals.suggested;
  saveSettings(g.__mintDb as DatabaseSync, { sleeveMultipliers: { VG: 0.5 } });
  const after = (await j(await getSession(req("GET"), ctx(String(lot.id))))).totals.suggested;
  assert.ok(after < before);
});
```

In `tests/lookup-route.test.ts`, set `g.__mintDb = openDb(":memory:")` in `before` and delete it in `after`, so the route never opens `./data/mint.db`.

- [ ] **Step 2: Run, expect FAIL** (totals unchanged: routes still read the file).
- [ ] **Step 3: Implement** the two call-site changes. The existing "invalid settings.json gives a 500" test must keep passing through the re-exported hook.
- [ ] **Step 4: Run `npm test`, expect PASS.**
- [ ] **Step 5: Commit** `feat(settings): lookup and collection routes use saved settings`

---

### Task 5: `lib/settings-form.ts` (pure, client-safe)

**Files:**
- Create: `lib/settings-form.ts` — imports only from `lib/types.ts`
- Test: `tests/settings-form.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const FIELD_KEYS: readonly [
    "sell.undercutPercent", "sell.floor",
    "local.localDiscountMultiplier", "local.discogsFeePercent", "local.defaultRegionMultiplier",
    "sleeveMultipliers.M", "sleeveMultipliers.NM", "sleeveMultipliers.VG+", "sleeveMultipliers.VG",
    "sleeveMultipliers.G+", "sleeveMultipliers.G", "sleeveMultipliers.F", "sleeveMultipliers.P",
    "offer.ladderPercents", "offer.openingPercent", "offer.marginPercent", "offer.overheadPerRecord",
    "offer.pickThreshold", "offer.bulkEach", "offer.unverifiedSteps",
  ];
  export type FieldKey = (typeof FIELD_KEYS)[number];
  export type SettingsForm = Record<FieldKey, string>;
  export type EditableSettings = {
    sleeveMultipliers: Record<Grade, number>;
    sell: Settings["sell"];
    local: Omit<Settings["local"], "regionMultipliers">;
    offer: Settings["offer"];
  };
  export const PERCENT_FIELDS: ReadonlySet<FieldKey>;   // multiplier-backed keys shown as %
  export function toForm(s: Settings): SettingsForm;
  export function fromForm(f: SettingsForm): { ok: true; value: EditableSettings } | { ok: false; errors: Partial<Record<FieldKey, string>> };
  export function parseLadder(text: string): { ok: true; value: number[] } | { ok: false; error: string };
  export function formatDefault(key: FieldKey, s: Settings): string;  // "40%", "$1.50", "1", "30, 40, 50, 60"
  export function toFormLoose(raw: unknown, defaults: Settings): SettingsForm;  // per field: saved value if the right type, else default
  ```
  `PERCENT_FIELDS` = `local.localDiscountMultiplier`, `local.defaultRegionMultiplier`, and the eight `sleeveMultipliers.*`.

- [ ] **Step 1: Write the failing tests**

```ts
test("multipliers show as percents without float noise and round-trip", () => {
  const f = toForm(defaults);
  assert.equal(f["sleeveMultipliers.VG+"], "95");
  assert.equal(f["local.localDiscountMultiplier"], "80");
  assert.equal(f["offer.ladderPercents"], "30, 40, 50, 60");
  const r = fromForm({ ...f, "sleeveMultipliers.VG+": "95.5" });
  assert.ok(r.ok); assert.equal(r.value.sleeveMultipliers["VG+"], 0.955);
  const back = fromForm(f); assert.ok(back.ok);
  assert.deepEqual(back.value.sleeveMultipliers, defaults.sleeveMultipliers);
});
test("empty and non-numeric fields are errors, never 0", () => {
  const r = fromForm({ ...toForm(defaults), "sell.floor": "", "offer.marginPercent": "abc" });
  assert.equal(r.ok, false);
  assert.equal(!r.ok && r.errors["sell.floor"], "Enter a number.");
  assert.equal(!r.ok && r.errors["offer.marginPercent"], "Enter a number.");
});
test("parseLadder accepts commas and spaces and rejects bad ladders", () => {
  assert.deepEqual(parseLadder(" 30,40  50 , 60 "), { ok: true, value: [30, 40, 50, 60] });
  for (const bad of ["", "30, x", "40, 30", "30, 30", "0, 40", "40, 101", "10 20 30 40 50 60 70 80 90"]) {
    assert.equal(parseLadder(bad).ok, false, bad);
  }
});
test("opening offer must be on the ladder", () => {
  const r = fromForm({ ...toForm(defaults), "offer.ladderPercents": "30, 50, 60", "offer.openingPercent": "40" });
  assert.equal(!r.ok && r.errors["offer.openingPercent"], "Pick an opening offer from the ladder.");
});
test("field limits mirror parseSettings", () => {
  const bad = (k: FieldKey, v: string) => { const r = fromForm({ ...toForm(defaults), [k]: v }); return !r.ok && !!r.errors[k]; };
  assert.ok(bad("sleeveMultipliers.NM", "0")); assert.ok(bad("sleeveMultipliers.NM", "151"));
  assert.ok(bad("sell.undercutPercent", "100")); assert.ok(bad("local.discogsFeePercent", "-1"));
  assert.ok(bad("local.localDiscountMultiplier", "0")); assert.ok(bad("offer.unverifiedSteps", "1.5"));
  assert.ok(bad("offer.unverifiedSteps", "4")); assert.ok(bad("offer.bulkEach", "-0.01"));
});
test("toFormLoose keeps well-typed saved values and defaults the rest", () => {
  const f = toFormLoose({ offer: { openingPercent: 45, marginPercent: "x" }, sell: null }, defaults);
  assert.equal(f["offer.openingPercent"], "45");
  assert.equal(f["offer.marginPercent"], "30");
  assert.equal(f["sell.floor"], toForm(defaults)["sell.floor"]);
  assert.deepEqual(toFormLoose("junk", defaults), toForm(defaults));
});
test("every fromForm result passes parseSettings once merged over defaults", () => {
  const r = fromForm(toForm(defaults)); assert.ok(r.ok);
  assert.doesNotThrow(() => parseSettings(mergeSettings(defaults, r.value)));
});
```

- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.** Percent display: `String(Math.round(m * 10000) / 100)`; save: `Math.round(Number(text) * 100) / 10000`. A number field is valid only if `text.trim() !== ""` and `Number.isFinite(Number(text))`. Error texts: `"Enter a number."`, and per-range messages of the form `"Use 1 to 150."`, `"Use 0 or more."`, `"Use 0 up to (not including) 100."`, `"Use a whole number from 1 to 3."`; ladder errors name the problem (`"List 1 to 8 numbers, each above 0 and at most 100."`, `"Each step must be higher than the one before."`). Money defaults format as `$1.50`.
- [ ] **Step 4: Run `npm test`, expect PASS.**
- [ ] **Step 5: Commit** `feat(settings): form conversion and field checks`

---

### Task 6: `/api/settings` route

**Files:**
- Create: `app/api/settings/route.ts`
- Test: `tests/settings-route.test.ts`

**Interfaces:**
- Consumes: Task 3 store, `settingsErrorPath` (Task 2), `FIELD_KEYS` (Task 5), `readJson`, `errorJson`, `isObject`, `MAX_BODY` from `lib/collection/http.ts`, `requireSession`.
- Produces:
  - `GET` / `PUT` / `DELETE` 200 body: `{ settings, defaults, saved, updatedAt, invalid, savedRaw }` (`savedRaw` is `null` unless `invalid` is set). `export const dynamic = "force-dynamic"`.
  - `PUT` 400 body: `{ status: "error", kind: "bad-request", message, field? }`; `field` set only when `settingsErrorPath(message)` is in `FIELD_KEYS`.
  - `settings.json` invalid → `errorJson("settings", 500, "settings.json is invalid: …")`.

- [ ] **Step 1: Write the failing tests** (env + cookie setup and `g.__mintDb = openDb(":memory:")` per test, copied from `collection-routes.test.ts`)

```ts
test("GET returns defaults when nothing is saved", async () => {
  const b = await j(await GET(req("GET")));
  assert.equal(b.saved, false); assert.deepEqual(b.settings, b.defaults); assert.equal(b.invalid, null);
});
test("PUT saves and GET reflects it; DELETE resets", async () => {
  const cur = (await j(await GET(req("GET")))).settings;
  const r = await PUT(req("PUT", { ...cur, offer: { ...cur.offer, marginPercent: 35 } }));
  assert.equal(r.status, 200);
  assert.equal((await j(await GET(req("GET")))).settings.offer.marginPercent, 35);
  assert.equal((await j(await DELETE(req("DELETE")))).saved, false);
});
test("PUT with a string number is a 400 naming the field and stores nothing", async () => {
  const cur = (await j(await GET(req("GET")))).settings;
  const r = await PUT(req("PUT", { ...cur, local: { ...cur.local, localDiscountMultiplier: "0.8" } }));
  assert.equal(r.status, 400);
  assert.equal((await j(r)).field, "local.localDiscountMultiplier");
  assert.equal((await j(await GET(req("GET")))).saved, false);
});
test("PUT rejects a non-object body and bad JSON", async () => {
  assert.equal((await PUT(req("PUT", [1]))).status, 400);
  assert.equal((await PUT(req("PUT", "{bad"))).status, 400);
});
test("every handler 401s without a session", async () => {
  for (const h of [GET, PUT, DELETE]) assert.equal((await h(req("GET", undefined, false))).status, 401);
});
test("GET returns savedRaw when the stored row is invalid", async () => {
  (g.__mintDb as DatabaseSync).prepare("insert into settings (id, json, updated_at) values (1, ?, 1)")
    .run(JSON.stringify({ offer: { openingPercent: 45 } }));
  const b = await j(await GET(req("GET")));
  assert.match(b.invalid, /openingPercent/);
  assert.equal(b.savedRaw.offer.openingPercent, 45);
});
```

- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** the three handlers. `saveSettings` throwing a `settings:`-prefixed error → 400; any other throw (including a bad `settings.json`) → 500 `kind: "settings"`.
- [ ] **Step 4: Run `npm test`, expect PASS.**
- [ ] **Step 5: Commit** `feat(api): GET/PUT/DELETE /api/settings`

---

### Task 7: `/settings` page and nav link

**Files:**
- Create: `app/settings/page.tsx` (server component; same shape as `app/collection/page.tsx`: `SiteHeader`, `main.page`, masthead "Settings" with a one-line intro, `export const dynamic = "force-dynamic"`, `metadata.title = "Settings - Mint Condition"`)
- Create: `app/settings/SettingsForm.tsx` (`"use client"`)
- Modify: `app/NavLinks.tsx` (add `{ href: "/settings", label: "Settings" }` after Lots)
- Modify: `app/globals.css` (only what existing `.card`, `.form`, `.field`, `.field-error`, `.status` don't cover: fieldset/legend spacing, the hint line, a two-column grid for the sleeve fields that collapses to one column under 480px)

**Interfaces:**
- Consumes: `/api/settings` (Task 6), `toForm`, `toFormLoose`, `fromForm`, `parseLadder`, `formatDefault`, `FIELD_KEYS`, `PERCENT_FIELDS` (Task 5). Follow `app/collection/LotsList.tsx` for fetch, `readError`, the error card with Retry, and the 401 message.

- [ ] **Step 1: Build the component** to the spec's Page and Errors sections:
  - Loading state, then a load error card with Retry (no form) or the form.
  - Fieldsets: Selling, Local sale, Sleeve condition, Offers; the read-only currency line.
  - Each input: `id` = its `FieldKey`, a visible label, `inputMode="decimal"` (`numeric` for unverified steps), a `%` or `$` suffix in the label, the `Default: …` hint when the value differs from `formatDefault`, and the error from `fromForm` shown after blur or once a save is attempted. Hint and error ids go in `aria-describedby`.
  - The opening offer is a `<select>` whose options come from `parseLadder(form["offer.ladderPercents"])`; when the ladder doesn't parse, keep the current value as the only option.
  - Save is disabled while the form equals what was loaded; on submit, block if `fromForm` fails (focus the first bad field), else `PUT`. On 400 with `field`, show the message on that field and focus it; with no `field`, show it as a form error. On 200, reload the form from the response and set the status region to "Saved. Prices and lots use these now."
  - "Reset to defaults": `confirm("Reset every setting to its default?")`, then `DELETE`, then reload from the response.
  - The `invalid` banner (`role="alert"`) with the spec copy; the form fills from `toFormLoose(savedRaw, defaults)`.
  - `beforeunload` handler while dirty.
- [ ] **Step 2: Run `npm run typecheck` and `npm test`**, expect both green.
- [ ] **Step 3: Run `npm run dev` and check by hand** at 375px and desktop: change the margin and save → the status message appears; open a lot → the offer changes; reload `/settings` → the value persists; empty a field → "Enter a number." and Save blocked; reset → defaults return; the nav shows Settings as active.
- [ ] **Step 4: Run `npm run build`**, expect success.
- [ ] **Step 5: Commit** `feat(ui): settings page`

---

### Task 8: Docs, staging, PR

**Files:**
- Modify: `CLAUDE.md`
  - Layout: add `lib/settings-store.ts`, `lib/settings-form.ts`, `app/settings/`, `app/api/settings/`.
  - Decisions: one line saying tunables default from `settings.json` and are overridden by the saved row (`/settings`); currency and region multipliers come only from the file.
  - Status: change phases 4 and 5 from "deploy + phone check pending" to deployed and checked on prod; add "Phase 6a settings UI (2026-10-04): built on feat/settings-ui; <N> tests passing; migration 3 (settings table)".
- Modify: `README.md`: a short "Settings" section (what's editable, that it applies to every lot, reset).

- [ ] **Step 1: Make the edits** above; get `<N>` from `npm test`.
- [ ] **Step 2: Run `npm test && npm run typecheck`**, expect green.
- [ ] **Step 3: Commit** `docs: settings UI in CLAUDE.md and README`
- [ ] **Step 4: Ask the user before pushing.** Then `git push -u origin feat/settings-ui` and `git push origin feat/settings-ui:staging` (check first with `git log origin/staging..feat/settings-ui` that staging has nothing this branch lacks, and ask if it does).
- [ ] **Step 5: Check staging** (`https://mint-condition-staging.fly.dev`): the deploy workflow passes, `/settings` loads, saving the margin changes an existing lot's offer, and reload keeps it.
- [ ] **Step 6: Open the PR to `main`** with `gh pr create` (title "Phase 6a: settings UI"), summarising the migration and the staging check; end the body with the attribution line.

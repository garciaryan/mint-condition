# Phase 6a: Settings UI

Date: 2026-10-04 · Status: approved design, awaiting spec review
Follow-up: phase 6b (24h Discogs response cache) gets its own spec and adds `discogs.cacheHours` to this page.

## Why

Every tunable (undercut, local discount, sleeve multipliers, offer ladder, margin, ...) lives in `settings.json`,
which is baked into the image. Changing one means editing the file and pushing to `main`. The owner wants to tune
these from their phone, on the spot, with no deploy.

Success:
- A `/settings` page edits every tunable except currency and cache hours (see Non-goals).
- A save takes effect on the next request: new lookups and every lot (old ones included) use the new values.
- A bad value is rejected with the field named; a saved row that later becomes invalid never breaks pricing.
- `lib/pricing.ts` and `lib/offer.ts` stay pure and unchanged.

## Decisions (from brainstorming)

- **Scope:** all settings except region multipliers (unused today), currency (read-only), cache hours (phase 6b).
- **Existing lots:** settings are live for everything. Lots keep storing only grades, picks and offer inputs; no
  per-lot settings snapshot. Changing the margin re-prices old lots too.
- **Storage:** one SQLite row holding the full saved `Settings` object, layered over `settings.json` defaults.
- **Save semantics:** a save stores every value. A later change to a default in `settings.json` does not override a
  saved value; a setting newly added to the file gets its file default.
- **No in-memory cache:** routes already re-read `settings.json` per request; one SQLite row read per request is as
  cheap.

## Non-goals

- Region multipliers by area code (stay in `settings.json`, carried through untouched by the merge).
- Editing currency: Discogs returns prices in the seller account's currency, so changing it would only relabel
  numbers. Shown read-only with that note.
- Cache hours: nothing reads it until 6b.
- Per-lot settings snapshots, settings history, multi-tab conflict detection (last save wins).
- The `npm run lookup` CLI keeps reading `settings.json` only.

## Data

Migration 3 (append to `lib/migrations.ts`):

```sql
CREATE TABLE settings (
  id         INTEGER PRIMARY KEY CHECK (id = 1),  -- at most one row
  json       TEXT    NOT NULL,                     -- full Settings object as saved
  updated_at INTEGER NOT NULL                      -- ms epoch
);
```

No row = defaults.

## Units

### `lib/settings.ts` (pure, file loader unchanged)

Adds `mergeSettings(defaults: Settings, saved: unknown): unknown`:
- Walks the keys of `defaults`. Where both sides hold plain objects, recurse; otherwise take `saved`'s value when the
  key is present, else the default.
- Arrays (`offer.ladderPercents`) are replaced whole, never merged element-wise.
- Keys present only in `saved` are dropped.
- `local.regionMultipliers` and `discogs.currency` are never in the saved row (see `saveSettings`), so they always
  come from `settings.json`.
- The result is unvalidated; callers pass it to `parseSettings`.

### `lib/settings-store.ts` (server-side, DB access)

- `getSettings(db, defaultsPath?) → { settings: Settings; saved: boolean; updatedAt: number | null; invalid: string | null }`
  - Loads defaults with `loadSettings(defaultsPath)` (throws as today if the file is invalid).
  - No row → defaults, `saved: false`.
  - Row present → `parseSettings(mergeSettings(defaults, JSON.parse(row.json)))`. If parsing or validation throws,
    return the defaults with `invalid` set to the error message and `saved: true`.
- `getSavedRaw(db) → unknown | null` — the stored object as-is, so the page can show saved values when `invalid` is set.
- `saveSettings(db, input: unknown, defaultsPath?) → Settings` — merges `input` over defaults, validates with
  `parseSettings`, then writes the validated object minus `discogs.currency` and `local.regionMultipliers` (not
  editable here, so a later edit to them in `settings.json` still applies) to the row (`INSERT ... ON CONFLICT(id) DO UPDATE`). Throws on invalid input; the row is unchanged.
- `resetSettings(db)` — deletes the row.

### `lib/settings-form.ts` (pure, client-safe)

Converts between `Settings` and the form's string fields, and checks fields one by one.
- `toForm(settings) → SettingsForm` and `fromForm(form) → { ok: true; value: EditableSettings } | { ok: false; errors: Record<FieldKey, string> }`.
- Multipliers show as percentages: `local.localDiscountMultiplier` 0.8 ↔ "80", `sleeveMultipliers.VG+` 0.95 ↔ "95",
  `local.defaultRegionMultiplier` 1.0 ↔ "100". Round-trip keeps up to 2 decimals of percent (0.955 ↔ "95.5").
- Ladder text: comma- or space-separated numbers ("30, 40, 50, 60"). Errors: empty, not a number, duplicate, not
  ascending, out of (0, 100], more than 8.
- Opening offer must be one of the parsed ladder values.
- Field limits mirror `parseSettings`: sleeve 1–150%, undercut [0, 100), floor ≥ 0, local discount > 0, fee [0, 100),
  margin [0, 100), overhead / pick threshold / bulk each ≥ 0, unverified steps integer 1–3.
- `FieldKey` names are the dotted paths (`offer.marginPercent`), used for input ids and server error mapping.

### Field errors from the server

`parseSettings` throws messages starting `settings: <dotted.path> ...`. The route maps that path to a `field` in the
400 body so the page can mark the right input. Paths that don't match a form field go to a form-level error.

## Routes

`app/api/settings/route.ts`, each handler starting with `requireSession`:
- `GET` → `{ settings, defaults, saved, updatedAt, invalid, savedRaw }` (`savedRaw` only when `invalid` is set).
- `PUT` body = editable settings object (≤ `MAX_BODY`, 64 KB). 200 → same shape as GET. 400 →
  `{ status: "error", kind: "bad-request", message, field? }`.
- `DELETE` → resets; 200 with the GET shape.
- `settings.json` invalid → 500 `kind: "settings"` as today.

Callers switched to the store:
- `app/api/lookup/route.ts`: `loadSettings()` → `getSettings(getDb()).settings`.
- `lib/collection/http.ts` `withSettings`: same. The test hook `__setSettingsPathForTests` becomes the defaults path
  passed to `getSettings`; collection tests use an in-memory DB as they do today.

## Page

`/settings` (`app/settings/page.tsx` + client `app/settings/SettingsForm.tsx`); "Settings" link added to
`app/NavLinks.tsx` after "Lots".

Sections (each a `fieldset` with `legend`):
1. **Selling** — undercut %, minimum sell price ($).
2. **Local sale** — local price as % of market, Discogs fee %, default area multiplier (%).
3. **Sleeve condition** — M, NM, VG+, VG, G+, G, F, P: % of market value kept for that sleeve grade.
4. **Offers** — ladder (text), opening offer (select from parsed ladder), margin %, overhead per record ($), pick
   threshold ($), bulk price each ($), unverified steps (1–3).
5. **Currency** — read-only text: "USD (follows your Discogs seller account)".

Behaviour:
- Fields that differ from the default show a hint `Default: 40%`.
- Save is disabled until the form differs from what was loaded. Fields are checked with `settings-form` as you type
  (on blur, then live once an error shows). On save, a server 400 marks its field and moves focus there.
- After a save, the status live region says "Saved. Prices and lots use these now." and the form reloads from the
  response.
- "Reset to defaults" uses `confirm()`, then `DELETE`.
- `beforeunload` warns while there are unsaved edits.
- Layout and a11y follow phase 3: visible labels, 16px inputs, 44px controls, 3:1 borders, `aria-describedby` for
  hints and errors, works at 375px.

## Errors

| Case | Behaviour |
|---|---|
| 401 on load or save | "Signed out. Log in again." with a link to `/login`; edits stay in the form on save. |
| Load fails (network, 5xx) | Error with Retry; no form rendered. |
| Saved row invalid | Banner: "Your saved settings no longer pass a check (*reason*). Prices are using the defaults until you fix and save, or reset." Form filled from `savedRaw` (falling back to defaults per field). |
| Save 400 | Inline error on the named field, focus moves to it. |
| Two tabs | Last save wins. |
| `settings.json` invalid | 500 "settings.json is invalid: ..." as today. |

## Testing

Node's built-in runner, no new deps.
- `mergeSettings`: nested override, arrays replaced whole, new default keys kept, saved-only keys dropped.
- `settings-store` (in-memory DB): no row → defaults; save → get round-trip; reset; invalid row → defaults + `invalid`;
  invalid save throws and leaves the row; currency and region multipliers are not stored and follow the defaults file.
- Migration 3: applies on a version-2 DB; a second row with `id = 2` is rejected.
- `settings-form`: percent ↔ multiplier round-trip; ladder parsing (spaces, duplicates, order, bounds, count); opening
  must be on ladder; each field's error text.
- `/api/settings`: GET/PUT/DELETE, 401 without a session, 400 with `field`.
- Lookup and collection routes read saved settings: a lot's totals change after a save.

## Rollout

1. Branch `feat/settings-ui`.
2. Push to `staging`: confirm migration 3 applies, save a setting, check a lot's offer changes.
3. PR to `main` (deploys prod).
4. Update `CLAUDE.md` (layout, Status: phase 6a; phases 4 and 5 verified on prod) and add a "Settings" section to the
   README.

# Condition Notes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lot rows get one public condition note that the owner edits under the row. It survives lookups and goes to
the Discogs CSV `comments` column and the buy sheet.

**Architecture:** A pure, client-safe `lib/collection/notes.ts` (cleaning, tag chips). One new `items.notes` column
(migration 5), saved through the existing `PATCH /api/items/:id`. `ItemRow.tsx` gets an inline editor. The export
reads `item.notes`.

**Tech Stack:** Next.js App Router, TypeScript, `node:sqlite`, Node's built-in test runner.

**Spec:** `docs/superpowers/specs/2026-10-07-condition-notes-design.md`

## Global Constraints

- `NOTE_MAX = 255`. `NOTE_TAGS = ["sealed", "hype sticker", "promo", "OBI", "seam split", "ring wear", "writing"]`, in
  that order.
- Error copy, exactly: `Note must be text.` and `Note is longer than 255 characters.` (both 400, code
  `bad-request`).
- `lib/pricing.ts` and `lib/offer.ts` stay pure and are not touched. `notes.ts` has no Node or server imports.
- The worker never writes `notes`. A year change, re-price, retry and pressing pick keep `notes`.
- Colours come only from the existing tokens in `app/globals.css`. Any `tabular-nums` rule also sets
  `font-family: var(--font-numeric)`. The editor animates in only and is still under `prefers-reduced-motion`.
- User-visible text says "collection", never "lot".
- Migrations are append-only: add step 5, never edit steps 1–4.
- Every task ends with `npm test` and `npm run typecheck` green.
- Don't run `npm run build` while `next dev` is running. Check `pgrep -f "next dev"` first.

## Review Focus

1. A note made only of whitespace or line breaks, such as pasting "\n\n". It should save as `""`, which clears the
   note, not as a blank line. Test in Task 3.
2. A note exactly 255 characters long after cleaning, but longer before it (double spaces). It should be accepted,
   because the limit applies to the cleaned text. Test in Task 3.
3. Saving a note while the row is mid-lookup (`working`). The worker's `applyLookup` must not overwrite it, and the
   save must not re-queue the row. Test in Task 2.
4. A note beginning with `=`, `+`, `-` or `@` ("-light wear") in the CSV. It needs the formula guard. Test in Task 4.
5. A poll refresh arriving while the editor is open. The draft must not reset. This is UI-only, so it's a manual
   check in Task 5.

---

### Task 1: Pure note logic

**Files:**
- Create: `lib/collection/notes.ts`
- Test: `tests/collection-notes.test.ts`

**Interfaces:**
- Produces: `NOTE_MAX: number`, `NOTE_TAGS: readonly string[]`, `cleanNote(text: string): string`,
  `hasTag(note: string, tag: string): boolean`, `addTag(note: string, tag: string): string | null`.

- [ ] **Step 1: Write failing tests** in `tests/collection-notes.test.ts`:

```ts
test("cleanNote collapses whitespace and line breaks and trims", () => {
  assert.equal(cleanNote("  Seam\n\nsplit,\t ring wear　 "), "Seam split, ring wear");
  assert.equal(cleanNote("\n \n"), "");
});
test("hasTag matches whole words, any case", () => {
  assert.equal(hasTag("Seam split, light", "seam split"), true);
  assert.equal(hasTag("promotional copy", "promo"), false);
  assert.equal(hasTag("has obi", "OBI"), true);
});
test("addTag capitalises on an empty note and appends otherwise", () => {
  assert.equal(addTag("", "seam split"), "Seam split");
  assert.equal(addTag("", "OBI"), "OBI");
  assert.equal(addTag("Seam split", "ring wear"), "Seam split, ring wear");
  assert.equal(addTag("Seam split, ", "ring wear"), "Seam split, ring wear");
  assert.equal(addTag("Ring wear", "ring wear"), "Ring wear");
});
test("addTag returns null when the result would pass NOTE_MAX", () => {
  assert.equal(addTag("x".repeat(NOTE_MAX - 4), "sealed"), null);
  assert.equal(addTag("x".repeat(NOTE_MAX - 8), "sealed")?.length, NOTE_MAX);
});
test("NOTE_TAGS is the fixed list", () => {
  assert.deepEqual([...NOTE_TAGS], ["sealed", "hype sticker", "promo", "OBI", "seam split", "ring wear", "writing"]);
});
```

- [ ] **Step 2: Run** `npm test`. Expected: FAIL, the module can't be found.
- [ ] **Step 3: Implement** `lib/collection/notes.ts` with a header comment like `parse.ts` ("Pure and client-safe").
  `hasTag` escapes the tag for a regex and tests `\b<tag>\b` with the `i` flag. `addTag` trims trailing spaces and
  one trailing comma from the note before appending `", " + tag`.
- [ ] **Step 4: Run** `npm test && npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(notes): pure note cleaning and tag chips`.

### Task 2: Migration 5, store and view

**Files:**
- Modify: `lib/migrations.ts` (append step 5), `lib/collection/types.ts` (`ItemRow.notes`), `lib/collection/store.ts`
  (`toItem`, `LIST_COLUMNS`, `updateItemFields`), `lib/collection/view.ts` (`ItemView.notes`, `toItemView`)
- Modify fixtures (add `notes: ""` next to `refresh: false`): `tests/collection-export.test.ts`,
  `tests/collection-ui.test.ts`, `tests/collection-view.test.ts`, `tests/offer.test.ts`
- Test: `tests/db.test.ts`, `tests/collection-store.test.ts`

**Interfaces:**
- Produces: `ItemRow.notes: string`, `ItemView.notes: string`, and
  `updateItemFields(db, id, patch: { record?: Grade; sleeve?: Grade; year?: number | null; notes?: string }): ItemRow | null`.
  It stores `notes` exactly as given. The caller cleans it.

- [ ] **Step 1: Write failing tests.**
  - `tests/db.test.ts`, test `"migration 5 adds items.notes to a version-4 database"`. It mirrors the migration 4
    test: `migrate(db, migrations.slice(0, 4))`, insert an item, `assert.equal(migrate(db, migrations), 5)`, and
    `select notes from items` returns `{ notes: "" }`.
  - `tests/collection-store.test.ts`, test `"notes save alone and survive lookup, year change and pick"`:
    - Add an item. `claimNextPending`, so the row is `working`.
    - `updateItemFields(db, id, { notes: "Seam split" })` returns `status: "working"` and `notes: "Seam split"`.
    - `applyLookup(db, id, { status: "priced", releaseId: 5, release: cand(5), suggestions: { NM: 1 }, pricedAt: 9 })`,
      then `getItem(...).notes === "Seam split"`.
    - `updateItemFields(db, id, { year: 1971 }).notes === "Seam split"`.
    - The row from `listItems(db, s.id)` has `notes === "Seam split"`.
    - A second item made `to-pick` via `applyLookup` with `candidates: [cand(7)]`, then `pickRelease(db, id2, 7)`,
      keeps its note.
    - A notes-only `updateItemFields` on a priced row leaves `status`, `releaseId`, `suggestions` and `refresh`
      unchanged.
- [ ] **Step 2: Run** `npm test`. Expected: the new tests FAIL, because there is no `notes` column.
- [ ] **Step 3: Implement.**
  - Migration step 5:
    `ALTER TABLE items ADD COLUMN notes TEXT NOT NULL DEFAULT '';  -- public listing comment; '' = none`
  - Add `notes` to `LIST_COLUMNS` and map it in `toItem`.
  - `updateItemFields` runs `UPDATE items SET notes = ? WHERE id = ?` only when `patch.notes !== undefined`.
  - `toItemView` copies `notes`.
  - Add a doc comment on `ItemRow.notes`: "Public listing comment; '' = none. Never written by the worker."
  - Update the four fixtures.
- [ ] **Step 4: Run** `npm test && npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(notes): items.notes column (migration 5) in store and view`.

### Task 3: PATCH /api/items/:id accepts notes

**Files:**
- Modify: `app/api/items/[id]/route.ts`
- Test: `tests/collection-routes.test.ts`

**Interfaces:**
- Consumes: `cleanNote`, `NOTE_MAX` (Task 1); `updateItemFields(..., { notes })` (Task 2).
- Produces: `PATCH /api/items/:id` body `{ notes?: string }`. The response `ItemView` includes `notes`.

- [ ] **Step 1: Write a failing test**, `"PATCH item notes: cleaned, validated, no re-queue"`. Use the same setup as
  `"patch grades re-values without re-queuing"` (add one line, `await kickWorker()`, so the row is priced). Then:

```ts
const v = await j(await patchItem(req("PATCH", { notes: "  Seam\nsplit  " }), ctx(itemId)));
assert.equal(v.notes, "Seam split");
assert.equal(v.status, "priced");
assert.equal((await j(await patchItem(req("PATCH", { notes: "\n\n" }), ctx(itemId)))).notes, "");
const exact = `${"a".repeat(253)}  b`; // 256 raw, 255 cleaned
assert.equal((await j(await patchItem(req("PATCH", { notes: exact }), ctx(itemId)))).notes.length, 255);
const long = await patchItem(req("PATCH", { notes: "a".repeat(256) }), ctx(itemId));
assert.equal(long.status, 400);
assert.equal((await j(long)).message, "Note is longer than 255 characters.");
const bad = await patchItem(req("PATCH", { notes: 5 }), ctx(itemId));
assert.equal(bad.status, 400);
assert.equal((await j(bad)).message, "Note must be text.");
assert.equal((await j(await getSession(req("GET"), ctx(lotId)))).items[0].notes, "a".repeat(253) + " b");
```

  Use the error-body field the existing `errorJson` produces. Check another 400 assertion in this file for its name.
- [ ] **Step 2: Run** `npm test`. Expected: FAIL, because `notes` is ignored.
- [ ] **Step 3: Implement.** Next to the year check, validate `b.notes`: a non-string gives
  `errorJson("bad-request", 400, "Note must be text.")`. A cleaned value longer than `NOTE_MAX` gives
  `errorJson("bad-request", 400, "Note is longer than 255 characters.")`. Otherwise set `fields.notes`, and widen the
  `fields` type. Don't set `kick` for notes.
- [ ] **Step 4: Run** `npm test && npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(notes): save notes through PATCH /api/items/:id`.

### Task 4: CSV comments and buy sheet

**Files:**
- Modify: `lib/collection/export.ts`, `app/collection/[id]/print/page.tsx`, the print styles (wherever the buy
  sheet's `.muted` lives)
- Test: `tests/collection-export.test.ts`

**Interfaces:**
- Consumes: `ItemRow.notes` (Task 2).
- Produces: `COLUMNS` = `release_id,price,media_condition,sleeve_condition,comments,status,external_id,private_notes`;
  `BuySheetRow.notes: string`.

- [ ] **Step 1: Write failing tests.**
  - Update `HEADER` to the new column list. In the first test's expected line, insert an empty comments field:
    `...,Very Good (VG),,Draft,mc-7,Estate`.
  - New test `"notes go to comments, quoted and formula-safe"`:
    - `priced({ id: 8, notes: 'Seam split, "promo"' })` produces the field `"Seam split, ""promo"""`.
    - `priced({ id: 9, notes: "-light wear" })` produces the field ` -light wear`.
    - `private_notes` is still the lot name.
  - New test `"buy sheet rows carry notes"`: `buySheetRows([priced({ notes: "OBI" })], settings, inputs)[0].notes`
    equals `"OBI"`, and a row without a note gives `""`. Build `inputs` the same way the existing buy-sheet tests
    do.
- [ ] **Step 2: Run** `npm test`. Expected: FAIL.
- [ ] **Step 3: Implement.** Add `comments` to `COLUMNS` after `sleeve_condition`, and push `item.notes` in the same
  position. Add `notes: item.notes` to `buySheetRows`. In the print page's Title cell, after the title or `—`,
  render `{r.notes && <div className="muted note">{r.notes}</div>}`. Give `.note` a smaller font size in the print
  styles. Check that a `tests/discogs-terms.test.ts` or `tests/docs.test.ts` assertion on the CSV header still
  passes, and update any that list the columns.
- [ ] **Step 4: Run** `npm test && npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(notes): notes in the Discogs CSV comments and on the buy sheet`.

### Task 5: Note editor on lot rows

**Files:**
- Modify: `app/collection/[id]/ItemRow.tsx`, `app/collection/[id]/LotView.tsx`, `app/globals.css`
- Test: `tests/motion.test.ts`, `tests/font.test.ts` and `tests/theme-contrast.test.ts` must still pass. No new pure
  logic, because chip state comes from `hasTag`/`addTag`.

**Interfaces:**
- Consumes: `NOTE_MAX`, `NOTE_TAGS`, `hasTag`, `addTag` (Task 1); `ItemView.notes` (Task 2); PATCH `{ notes }`
  (Task 3).
- Produces: a new `ItemRow` prop,
  `onNote: (id: number, notes: string) => Promise<{ ok: true } | { ok: false; message: string }>`. In `LotView`
  it calls `api(\`/api/items/${id}\`, "PATCH", { notes })`, then `refresh()`, and returns the result. It does not
  call `setNotice`: the editor shows the error itself.

- [ ] **Step 1: Implement the editor in `ItemRow`** as the spec's "Row UI" section describes:
  - State: `editing`, `draft`, `saving`, `error`.
  - A ref on the Note button so focus can return to it.
  - `useId()` for the ids used by `aria-controls` and `aria-describedby`.
  - The saved note renders as `<div className="sub row-note">` after the credit line.
  - Button text: "Note" or "Edit note", with `<span className="sr-only"> for {title}</span>`.
  - The textarea's `onKeyDown`: Enter calls `preventDefault()` and saves, whatever Shift is doing. Escape cancels.
  - Chips are `<button type="button" className="chip">+ {tag}</button>`, disabled when
    `hasTag(draft, tag) || addTag(draft, tag) === null`.
  - Save: `aria-busy` and disabled while saving. On `ok`, close the editor and focus the Note button. On failure,
    set `error`, which renders as `<p role="alert">`.
  - Opening the editor sets `draft = item.notes`. The draft is never synced from props while open.
- [ ] **Step 2: Add the CSS** in `app/globals.css`:
  - `.row-note` wraps (`overflow-wrap: anywhere`).
  - `.note-editor` has `grid-column: 1 / -1` in the desktop and middle layouts, and a new `note` area added as the
    last row of the ≤480px `grid-template-areas`.
  - Chips are at least 44px tall on touch.
  - The counter uses `font-variant-numeric: tabular-nums; font-family: var(--font-numeric)`.
  - The animate-in uses the same keyframes and tokens as the existing menus.
  - Tokens only.
- [ ] **Step 3: Run** `npm test && npm run typecheck`. Expected: PASS, including the motion, font and contrast
  tests.
- [ ] **Step 4: Manual check** with `npm run dev` (use the running server if there is one) at desktop width and at
  375px:
  - Add a note with two chips and save. The line shows. Re-price the collection: the note stays.
  - Open the editor and wait through a poll: the draft stays.
  - Enter saves, Escape cancels, and focus returns to the button.
  - Saving 300 pasted characters is impossible (`maxLength`).
  - Turn the network off and save: the inline alert appears and the draft is kept.
  - The CSV download and buy sheet show the note.
- [ ] **Step 5: Commit** `feat(notes): note editor on collection rows`.

### Task 6: Live check and docs

**Files:**
- Modify: `CLAUDE.md` (Status line, Layout entry for `lib/collection/notes.ts`), the spec's Status line, and
  `docs/ROADMAP.md` (mark Phase 9 built), if it is on `main` by then.

- [ ] **Step 1: Live CSV check (the owner does this on discogs.com).** Export a collection where one row has a
  255-character note containing a comma and a quote. Upload it at Discogs inventory upload as Draft, and confirm
  the comment arrives whole. If Discogs cuts it, lower `NOTE_MAX` to the real limit (and the Task 1 and 3 tests
  with it), and record the limit in the spec.
- [ ] **Step 2: Test migration 5 against a production copy:** `DATA_DIR=data/prod-copy npm run dev` (DEPLOY.md §9).
  Existing collections open, and rows show no note.
- [ ] **Step 3: Update the docs.** Add a CLAUDE.md status line, "Phase 9 condition notes (date): migration 5
  (`items.notes`), public note → CSV `comments` and buy sheet; N tests passing", and add `lib/collection/notes.ts`
  to Layout.
- [ ] **Step 4: Run** `npm test && npm run typecheck`, then commit `docs: phase 9 condition notes status`.

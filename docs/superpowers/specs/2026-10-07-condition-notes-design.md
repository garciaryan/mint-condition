# Phase 9: Condition notes

Date: 2026-10-07 · Status: built and checked (phone and desktop, live Discogs CSV upload, production-copy migration)
Builds on: `docs/superpowers/specs/2026-10-04-collection-mode-design.md` (lots, rows),
`docs/superpowers/specs/2026-10-04-export-print-design.md` (CSV export, buy sheet). Roadmap: `docs/ROADMAP.md`.

## Why

A seam split, ring wear, a promo stamp, a hype sticker, an OBI or a sealed copy changes what a record is worth and
what its listing should say. Lot rows have nowhere to write that down, so it is lost between the fair and the
Discogs listing.

Success:
- A note added to a lot row on a phone survives re-pricing.
- The note appears in the Discogs CSV's `comments` column and on the buy sheet.

## Decisions (from brainstorming)

- **Audience:** the note is public listing text for buyers ("Seam split, light ring wear, hype sticker"). It goes to
  the listing's `comments`. Discogs' `private_notes` keeps the collection name, as today. There is no second, private
  field.
- **Approach:** one plain-text `notes` column. Tag chips append a phrase to the text and are not stored separately,
  so what the owner sees is exactly what Discogs gets.
- **Editing:** a "Note" button on the row opens an editor under the row. Not a dialog, and not a field that is
  always open.
- **Out of scope:** notes in the paste list, an editable tag list, and notes on the single-record lookup (nothing
  is saved there).

## Data

Migration 5 (appended to `lib/migrations.ts`):

```sql
ALTER TABLE items ADD COLUMN notes TEXT NOT NULL DEFAULT '';  -- public listing comment; '' = none
```

- `ItemRow.notes: string` and `ItemView.notes: string`. The store's row mapping and `LIST_COLUMNS` include `notes`.
- Notes describe the physical copy, so nothing that changes the lookup clears them: the worker, re-price, retry,
  a year change, and picking a pressing all leave `notes` alone. The worker's patches (`LookupPatch`) have no
  `notes` field.

## Pure logic: `lib/collection/notes.ts`

Client-safe (no Node or server imports), like `parse.ts`.

- `NOTE_MAX = 255`.
- `NOTE_TAGS = ["sealed", "hype sticker", "promo", "OBI", "seam split", "ring wear", "writing"]` (fixed, in this
  order).
- `cleanNote(text: string): string`. Turns line breaks, tabs and runs of whitespace (including U+3000 and U+00A0)
  into one space, then trims. The result can be longer than `NOTE_MAX`. Callers check the length.
- `hasTag(note: string, tag: string): boolean`. True when the tag is in the note as whole words, ignoring case.
  "seam split" matches "Seam split, light"; "promo" does not match "promotional".
- `addTag(note: string, tag: string): string | null`.
  - Returns `note` unchanged when `hasTag` is true.
  - On an empty note, returns the tag with its first letter capitalised ("Seam split"). "OBI" is already capitals.
  - Otherwise returns `note + ", " + tag`, after trimming trailing spaces and one trailing comma, full
    stop or semicolon from `note` ("Light wear." + promo → "Light wear, promo").
  - Returns `null` when the cleaned result would be longer than `NOTE_MAX`.

## API

`PATCH /api/items/:id` accepts an optional `notes`:

- Must be a string (otherwise 400 "Note must be text.").
- Stored as `cleanNote(notes)`. If that is longer than `NOTE_MAX`: 400 "Note is longer than 255 characters." An empty
  string clears the note.
- Can be combined with grade, year or pick changes in one request, but saving a note on its own never sets
  `kick`, never changes `status`, and never touches lookup columns.
- `updateItemFields` takes `notes?: string` in its patch and runs a separate `UPDATE items SET notes = ?` only when it
  is given.
- The response is the row's `ItemView`, as now, including `notes`.
- `POST /api/sessions/:id/items` takes an optional `notes` per line, with the same cleaning and limit (`parseNote`;
  errors start "Line N: "). Undo after Remove sends the removed row's note, so it comes back.

## Row UI (`app/collection/[id]/ItemRow.tsx`)

- **Saved note:** shown in `row-main` as its own line after the release and credit lines, in the `sub` style (class
  `row-note`). Shown on every status, including rows with no match. Long notes wrap and are never cut off.
- **Button:** "Note", or "Edit note" when there is a note, in `row-actions` before Remove. It has `aria-expanded`
  and `aria-controls` pointing at the editor, and screen-reader text naming the record, as the other row actions do.
- **Phones (≤480px):** the title has its own full-width line, with the cherry-pick star pinned top-right. The
  details (label line, Discogs credit, note; `.row-meta`) sit beside the cover, and the price gets its own line: a padded "Market value" box with
  Low / Suggested / High labelled like the single-record result card (`.row-market`; wider screens keep the compact
  cell). The
  Note button is a 44px pencil icon. Its text stays for screen readers, and it is filled
  when the row has a note. Rec and Slv stack, each full width. The status badge and buttons share one bottom line
  (`.row-foot`, `display: contents` on wider screens), and the buttons wrap to a second line when they don't fit.
- **Editor:** a block spanning the row's full width (`grid-column: 1 / -1`, below the rest). It
  contains:
  - A labelled `<textarea>` ("Note for <title>", visually hidden label), 2 rows, 16px,
    `maxLength={NOTE_MAX * 4}` (only to stop huge pastes),
    placeholder "Condition notes for the listing". Its `aria-describedby` points at the counter and any error.
  - A counter of the cleaned length, "31/255". It turns red past the limit, and Save is then disabled.
  - Chip buttons, one per `NOTE_TAGS` entry, labelled "+ sealed" and so on. Pressing one sets the draft to
    `addTag(draft, tag)`. A chip is disabled when `hasTag(draft, tag)` is true, `addTag` returns `null`, or a save is
    in progress. Chips have a hover state.
  - Cancel and Save buttons, at least 44px tall.
- **Behaviour:**
  - Opening the editor copies the saved note into a draft held in the row's own state, so polling never overwrites
    it. Focus moves to the textarea.
  - Enter saves, with or without Shift, and never inserts a line break (they would be cleaned away anyway). Escape
    cancels. Neither acts while an input method is composing (`noteKeyAction`), so confirming a composed word never
    saves early.
  - Saving sends `PATCH { notes: draft }`. While saving, Save is disabled and shows that it is busy, the textarea
    is read-only and the chips are disabled. A save that answers after Cancel is ignored. On success the saved row
    replaces the old one at once, before the refresh. On success the
    editor closes, and focus returns to the Note button.
  - On failure the editor stays open with the draft, and the API's message appears in a `role="alert"` line inside
    the editor.
  - Cancel throws away the draft and returns focus to the Note button.
  - Each row has its own editor, and several can be open at once.
- **Styling:** colours only from the existing tokens. The editor uses the existing animate-in motion tokens and does
  not animate under `prefers-reduced-motion` (covered by `tests/motion.test.ts`). The counter uses
  `tabular-nums`, so it must also set `font-family: var(--font-numeric)` (`tests/font.test.ts`). Works at 375px.

## Export

- **CSV (`lib/collection/export.ts`):** add a `comments` column after `sleeve_condition`, filled with `item.notes`
  (empty when there is no note). The existing `field()` already handles quoting and the guard against spreadsheet
  formulas. Notes contain no line breaks because `cleanNote` removed them. `private_notes` is unchanged.
- **Buy sheet:** `BuySheetRow` gains `notes: string`. The Title cell shows the note under the title or query in a
  small muted line when it is not empty.
- **Verify live before merging:** upload a draft CSV with a 255-character comment containing a comma and a quote. If
  Discogs rejects or truncates it, lower `NOTE_MAX` to the real limit and note it here.

## Discogs terms

Notes are the owner's own words, not Discogs data, so no credit and no 6-hour limit apply.

## Tests

- `tests/notes.test.ts`:
  - `cleanNote`: collapsing whitespace and line breaks, trimming.
  - `hasTag`: whole words, ignoring case.
  - `addTag`: capitalising on an empty note, appending with ", ", trimming a trailing comma, full stop or semicolon, measuring the cleaned note, no change for a
    duplicate, `null` when over `NOTE_MAX`.
- Migration: existing items get `notes = ''` after migration 5.
- Store and route:
  - PATCH saves cleaned notes and rejects non-strings and notes over 255 characters.
  - A notes-only PATCH leaves `status`, `refresh` and the lookup columns unchanged and doesn't start the worker.
  - Notes survive a worker lookup patch, a year change and a pressing pick.
- Export:
  - The CSV header includes `comments`.
  - A note with a comma, a quote, or a leading `=` comes out correctly quoted or guarded.
  - Buy sheet rows include `notes`.
- The existing contrast, motion and font tests still pass with the new CSS.

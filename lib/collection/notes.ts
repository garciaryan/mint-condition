// Condition notes: the public listing comment on a lot row. Pure and client-safe: no Node or server imports.

/** Longest note kept; it goes to the Discogs listing's comments. */
export const NOTE_MAX = 255;

/** Tag chips under the note editor, in display order. Each adds its phrase to the note text. */
export const NOTE_TAGS = ["sealed", "hype sticker", "promo", "OBI", "seam split", "ring wear", "writing"] as const;

/** One line of text: line breaks and runs of whitespace become one space. May still be longer than NOTE_MAX. */
export function cleanNote(text: string): string {
  return text.replace(/[\s　 ]+/g, " ").trim();
}

/** A note from a request body, cleaned and checked against NOTE_MAX. */
export function parseNote(raw: unknown): { ok: true; value: string } | { ok: false; message: string } {
  if (typeof raw !== "string") return { ok: false, message: "Note must be text." };
  const value = cleanNote(raw);
  if (value.length > NOTE_MAX) return { ok: false, message: `Note is longer than ${NOTE_MAX} characters.` };
  return { ok: true, value };
}

/** True when the tag appears in the note as whole words, ignoring case. */
export function hasTag(note: string, tag: string): boolean {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`, "i").test(note);
}

/** The note with the tag appended (", tag"), unchanged if it is already there, or null if it would not fit. */
export function addTag(note: string, tag: string): string | null {
  if (hasTag(note, tag)) return note;
  const base = note.trimEnd().replace(/,$/, "").trimEnd();
  const next = base ? `${base}, ${tag}` : tag.charAt(0).toUpperCase() + tag.slice(1);
  return next.length > NOTE_MAX ? null : next;
}

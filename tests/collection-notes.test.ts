import { test } from "node:test";
import assert from "node:assert/strict";
import { addTag, cleanNote, hasTag, noteKeyAction, NOTE_MAX, NOTE_TAGS } from "../lib/collection/notes.ts";

test("cleanNote collapses whitespace and line breaks and trims", () => {
  assert.equal(cleanNote("  Seam\n\nsplit,\t ring\u00A0wear\u3000 "), "Seam split, ring wear");
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
  assert.equal(NOTE_MAX, 255);
  assert.deepEqual([...NOTE_TAGS], ["sealed", "hype sticker", "promo", "OBI", "seam split", "ring wear", "writing"]);
});

test("addTag replaces a trailing full stop or semicolon with the comma", () => {
  assert.equal(addTag("Light wear.", "promo"), "Light wear, promo");
  assert.equal(addTag("Light wear; ", "promo"), "Light wear, promo");
});

test("addTag measures the cleaned note, so extra spaces don't block a tag that fits", () => {
  const spaced = `${"x".repeat(100)}${" ".repeat(150)}y`; // 251 raw, 102 cleaned
  assert.equal(addTag(spaced, "sealed"), `${"x".repeat(100)}${" ".repeat(150)}y, sealed`);
});

test("noteKeyAction: Enter saves, Escape cancels, nothing while an input method is composing", () => {
  const k = (key: string, o: { composing?: boolean; keyCode?: number; inField?: boolean } = {}) =>
    noteKeyAction({ key, isComposing: o.composing ?? false, keyCode: o.keyCode ?? 0, inField: o.inField ?? true });
  assert.equal(k("Enter"), "save");
  assert.equal(k("Escape"), "cancel");
  assert.equal(k("Escape", { inField: false }), "cancel");
  assert.equal(k("Enter", { inField: false }), null);
  assert.equal(k("Enter", { composing: true }), null);
  assert.equal(k("Enter", { keyCode: 229 }), null);
  assert.equal(k("Escape", { composing: true }), null);
  assert.equal(k("a"), null);
});

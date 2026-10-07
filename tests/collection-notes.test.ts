import { test } from "node:test";
import assert from "node:assert/strict";
import { addTag, cleanNote, hasTag, NOTE_MAX, NOTE_TAGS } from "../lib/collection/notes.ts";

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
  assert.equal(NOTE_MAX, 255);
  assert.deepEqual([...NOTE_TAGS], ["sealed", "hype sticker", "promo", "OBI", "seam split", "ring wear", "writing"]);
});

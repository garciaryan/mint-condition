import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync("app/globals.css", "utf8");

test("a paragraph alone in a card (\"No lots yet\") gets even space above and below", () => {
  // The browser's default paragraph margin would add a line of space above the text but not below.
  assert.match(css, /\.card p:first-child \{\s*margin-top: 0;\s*\}/);
  assert.match(css, /\.card p:last-child \{\s*margin-bottom: 0;\s*\}/);
});

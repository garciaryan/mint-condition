import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync("app/globals.css", "utf8");

test("a paragraph alone in a card (\"No lots yet\") gets even space above and below", () => {
  // The browser's default paragraph margin would add a line of space above the text but not below.
  assert.match(css, /\.card p:first-child \{\s*margin-top: 0;\s*\}/);
  assert.match(css, /\.card p:last-child \{\s*margin-bottom: 0;\s*\}/);
});

test("the settings currency line sits a field-gap below the inputs (not overridden by the section's p rule)", () => {
  assert.match(css, /\.settings-section > p\.settings-currency \{\s*margin: 16px 0 0;\s*\}/);
});

test("phone menu links are as wide as their text, so the active underline only spans the words", () => {
  assert.match(css, /\.site-menu-panel \.nav \{\s*flex-direction: column;\s*align-items: flex-start;\s*\}/);
});

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

test("collapsed rail items keep their names for screen readers (the label is hidden visually, not removed)", () => {
  assert.match(css, /\.site-nav\.collapsed \.nav-label \{[^}]*clip: rect\(0 0 0 0\);/);
});

test("the login page centers its heading and card, and only its footer is centered", () => {
  const page = readFileSync("app/login/page.tsx", "utf8");
  assert.match(page, /<main className="page login-page">/);
  assert.match(css, /\.login-page \{[^}]*flex: 1 0 auto;[^}]*display: flex;[^}]*flex-direction: column;[^}]*align-items: center;[^}]*justify-content: center;/);
  assert.match(css, /\.login-page \.login-card \{[^}]*width: 100%;/);
  assert.match(css, /body:has\(\.login-page\) \.site-footer \{[^}]*text-align: center;/);
  assert.match(css, /body:has\(\.login-page\) \.site-footer-links \{[^}]*justify-content: center;/);
});

test("the show-password toggle is an eye icon inside the field, named and pressable", () => {
  const form = readFileSync("components/login/LoginForm.tsx", "utf8");
  assert.match(form, /className="password-toggle"[\s\S]*aria-label="Show password"[\s\S]*aria-pressed=\{show\}/);
  assert.match(form, /<NavIcon name=\{show \? "eye-off" : "eye"\} \/>/);
  assert.match(css, /\.password-field input \{[^}]*padding-right: var\(--control-h\);/);
  assert.match(css, /\.password-toggle \{[^}]*position: absolute;[^}]*width: var\(--control-h\);[^}]*height: var\(--control-h\);/);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync("app/globals.css", "utf8");
const reduced = (() => {
  const start = css.indexOf("@media (prefers-reduced-motion: reduce)");
  assert.ok(start >= 0, "missing reduced-motion block");
  let depth = 0;
  for (let i = css.indexOf("{", start); i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}" && --depth === 0) return css.slice(start, i);
  }
  throw new Error("unclosed reduced-motion block");
})();

test("motion timing comes from the shared tokens", () => {
  assert.match(css, /--dur-fast: 120ms;/);
  assert.match(css, /--dur: 180ms;/);
  assert.match(css, /--ease: cubic-bezier\(0\.2, 0\.7, 0\.2, 1\);/);
  assert.doesNotMatch(css, /transition:[^;]*\d+ms/, "transitions use --dur-fast / --dur, not hard-coded times");
});

test("menus and dialogs animate in", () => {
  for (const sel of [".dropdown-panel", ".site-menu-panel.open", ".dialog", ".scrim"]) {
    const rules = [...css.matchAll(new RegExp(`${sel.replace(/\./g, "\\.")}\\s*\\{[^}]*\\}`, "g"))].map((m) => m[0]);
    assert.ok(rules.some((r) => /animation:/.test(r)), `${sel} has an opening animation`);
  }
});

test("reduced motion turns off transitions, animations and the press shrink", () => {
  assert.match(reduced, /transition: none !important;/);
  assert.match(reduced, /animation: none !important;/);
  assert.match(reduced, /transform: none !important;/);
});

test("a successful scan pulses the viewfinder frame (and reduced motion stops all animation)", () => {
  assert.match(css, /\.scanner-frame\.hit \{[^}]*border-color: var\(--fill\);[^}]*animation: scan-pulse /);
  assert.match(css, /@keyframes scan-pulse/);
});

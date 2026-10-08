import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = (p: string) => readFileSync(p, "utf8");
const css = src("app/globals.css");

test("refreshing prices on the result card is an icon button with a spoken name", () => {
  assert.match(src("components/layout/NavIcon.tsx"), /\n  refresh: /);
  const lookup = src("components/lookup/Lookup.tsx");
  assert.match(lookup, /className="icon-button refresh"[^>]*aria-label="Refresh prices"[^>]*title="Refresh prices"/s);
  assert.match(lookup, /<NavIcon name="refresh" \/>/);
});

test("the refresh icon spins while prices refresh", () => {
  assert.match(css, /\.icon-button\.refresh\[aria-busy="true"\] \.nav-icon \{[^}]*animation: spin/);
});

test("Vinyl versions looks like a dropdown: a field-styled toggle with a chevron", () => {
  assert.match(src("components/lookup/VersionsPanel.tsx"), /className="select-toggle"/);
  assert.match(css, /\.select-toggle \{[^}]*border: 1px solid var\(--field-line\);[^}]*background: var\(--field-bg\);/);
  assert.match(css, /\.select-toggle\[aria-expanded="true"\] \.chevron \{[^}]*transform: rotate\(180deg\)/);
});

test("hovering the refresh icon changes its colour, not a box behind it", () => {
  const hover = css.match(/\.icon-button:hover:not\(:disabled\) \{[^}]*\}/)?.[0] ?? "";
  assert.doesNotMatch(hover, /background/);
  assert.match(hover, /color: var\(--accent-hover\)/);
});

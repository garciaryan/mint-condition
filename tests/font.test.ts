import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync("app/globals.css", "utf8");
const layout = readFileSync("app/layout.tsx", "utf8");

test("Kanit is self-hosted through next/font with the weights the CSS uses", () => {
  assert.match(layout, /import \{ Kanit \} from "next\/font\/google";/);
  assert.match(layout, /weight: \["400", "500", "600", "700"\]/);
  assert.match(layout, /variable: "--font-kanit"/);
  assert.match(css, /font-family: var\(--font-kanit\), /);
  for (const w of css.matchAll(/font-weight: (\d+)/g)) {
    assert.ok(["400", "500", "600", "700"].includes(w[1]), `font-weight ${w[1]} is not a loaded Kanit weight`);
  }
});

test("every rule that lines numbers up keeps a font with even-width digits (Kanit has none)", () => {
  const rules = [...css.matchAll(/\{[^{}]*font-variant-numeric: tabular-nums;[^{}]*\}/g)].map((m) => m[0]);
  assert.ok(rules.length >= 10);
  for (const r of rules) assert.match(r, /font-family: var\(--font-numeric\);/, r);
  assert.match(css, /--font-numeric: ui-sans-serif, system-ui, /);
});

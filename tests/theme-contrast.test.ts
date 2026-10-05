// Reads the colour tokens straight from app/globals.css and checks WCAG contrast for the pairs the UI relies on,
// in both themes, so a palette tweak can't quietly break CLAUDE.md's 4.5:1 text and 3:1 control-border rules.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync("app/globals.css", "utf8");

function block(selector: string, from = 0): Record<string, string> {
  const start = css.indexOf(`${selector} {`, from);
  assert.ok(start >= 0, `missing ${selector}`);
  const body = css.slice(start, css.indexOf("}", start));
  return Object.fromEntries([...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}

const light = block(":root");
const darkPinned = block(':root[data-theme="dark"]');
const darkSystem = block(':root:not([data-theme="light"])', css.indexOf("@media (prefers-color-scheme: dark)"));
const dark = { ...light, ...darkPinned };

function lum(hex: string): number {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? [...h].map((c) => c + c).join("") : h;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255);
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
function ratio(a: string, b: string): number {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const TEXT: [string, string][] = [
  ["--ink", "--bg"], ["--ink", "--card"], ["--muted", "--bg"], ["--muted", "--card"],
  ["--accent", "--card"], ["--accent", "--bg"], ["--accent-ink", "--accent"], ["--danger", "--card"],
  ["--danger", "--error-bg"], ["--warn", "--notice-bg"], ["--warn", "--card"], ["--accent", "--accent-soft"],
  ["--muted", "--neutral-soft"], ["--ink", "--field-bg"], ["--toast-ink", "--toast-bg"], ["--toast-link", "--toast-bg"], ["--card", "--ink"],
  ["--fill-ink", "--fill"], ["--fill-ink", "--fill-hover"], ["--muted", "--notice-bg"], ["--accent", "--accent-tint"],
];
const BORDERS: [string, string][] = [["--field-line", "--card"], ["--field-line", "--field-bg"]];

for (const [name, theme] of [["light", light], ["dark", dark]] as const) {
  test(`${name} theme: text pairs reach 4.5:1 and control borders 3:1`, () => {
    for (const [fg, bg] of TEXT) {
      assert.ok(theme[fg] && theme[bg], `${name}: ${fg} or ${bg} not defined`);
      const r = ratio(theme[fg], theme[bg]);
      assert.ok(r >= 4.5, `${name}: ${fg} on ${bg} is ${r.toFixed(2)}:1`);
    }
    for (const [fg, bg] of BORDERS) {
      const r = ratio(theme[fg], theme[bg]);
      assert.ok(r >= 3, `${name}: ${fg} on ${bg} is ${r.toFixed(2)}:1`);
    }
  });
}

test("the system-dark block and the pinned-dark block define the same palette", () => {
  assert.deepEqual(darkSystem, darkPinned);
});

test("dark mode redefines every colour token", () => {
  const colourTokens = Object.keys(light).filter((k) => /^(#|rgba?\()/.test(light[k]));
  assert.deepEqual(colourTokens.filter((k) => !(k in darkPinned)), []);
});

test("the palette: parchment and deep-space blue pages, deep-space-blue text, cyan buttons in both themes", () => {
  assert.equal(light["--bg"], "#f4edea");
  assert.equal(light["--ink"], "#12263a");
  assert.equal(dark["--bg"], "#12263a");
  assert.equal(dark["--ink"], "#f4edea");
  for (const theme of [light, dark]) {
    assert.equal(theme["--fill"], "#06bcc1");
    assert.equal(theme["--fill-ink"], "#12263a");
  }
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { nextTheme, parseThemeCookie, THEME_COOKIE, themeCookie } from "../lib/theme.ts";

test("the theme button cycles system, light, dark", () => {
  assert.equal(nextTheme("system"), "light");
  assert.equal(nextTheme("light"), "dark");
  assert.equal(nextTheme("dark"), "system");
});

test("parseThemeCookie accepts light and dark only", () => {
  assert.equal(parseThemeCookie("light"), "light");
  assert.equal(parseThemeCookie("dark"), "dark");
  for (const v of [undefined, "", "system", "DARK", "blue"]) assert.equal(parseThemeCookie(v), null, String(v));
});

test("themeCookie pins a theme for a year or clears it for system", () => {
  assert.equal(THEME_COOKIE, "mc_theme");
  assert.equal(themeCookie("dark"), "mc_theme=dark; Path=/; Max-Age=31536000; SameSite=Lax");
  assert.equal(themeCookie("light"), "mc_theme=light; Path=/; Max-Age=31536000; SameSite=Lax");
  assert.equal(themeCookie("system"), "mc_theme=; Path=/; Max-Age=0; SameSite=Lax");
});

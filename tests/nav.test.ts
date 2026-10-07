import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { NAV_COOKIE, navCookie, navLots, parseNavCookie } from "../lib/nav.ts";

const css = readFileSync("app/globals.css", "utf8");

test("the sidebar opens expanded unless the cookie says collapsed", () => {
  assert.equal(parseNavCookie("collapsed"), true);
  for (const v of [undefined, "", "expanded", "COLLAPSED", "1"]) assert.equal(parseNavCookie(v), false, String(v));
});

test("navCookie remembers collapsed for a year and clears the cookie when expanded", () => {
  assert.equal(NAV_COOKIE, "mc_nav");
  assert.equal(navCookie(true), "mc_nav=collapsed; Path=/; Max-Age=31536000; SameSite=Lax");
  assert.equal(navCookie(false), "mc_nav=; Path=/; Max-Age=0; SameSite=Lax");
});

test("pages with the sidebar leave room for it, and the collapsed rail is narrower", () => {
  assert.match(css, /body:has\(\.site-nav\) \{[^}]*padding-left: var\(--nav-w\);/);
  assert.match(css, /body:has\(\.site-nav\.collapsed\) \{[^}]*--nav-w: /);
  assert.match(css, /\.site-nav \{[^}]*position: fixed;[^}]*width: var\(--nav-w\);/);
});

test("on phones the sidebar is a bottom tab bar, and the page and undo toast clear it", () => {
  const phone = css.slice(css.indexOf("/* Phone */"));
  assert.match(phone, /body:has\(\.site-nav\) \{[^}]*padding-left: 0;[^}]*padding-bottom: /);
  assert.match(phone, /\.site-nav \{[^}]*bottom: 0;[^}]*flex-direction: row;/);
  assert.match(phone, /\.undo-wrap \{[^}]*bottom: calc\(var\(--tabbar-h\)/);
});

test("the sidebar is not printed", () => {
  const print = css.slice(css.indexOf("@media print"));
  assert.match(print, /\.site-nav,/);
});

test("navLots keeps the first 3 lots (id and name only) and counts the rest", () => {
  const lot = (id: number) => ({ id, name: `Lot ${id}`, updatedAt: id });
  assert.deepEqual(navLots([], 3), { shown: [], more: 0 });
  assert.deepEqual(navLots([lot(1), lot(2), lot(3)], 3), {
    shown: [{ id: 1, name: "Lot 1" }, { id: 2, name: "Lot 2" }, { id: 3, name: "Lot 3" }],
    more: 0,
  });
  const five = navLots([1, 2, 3, 4, 5].map(lot), 3);
  assert.deepEqual(five.shown.map((l) => l.id), [1, 2, 3]);
  assert.equal(five.more, 2);
});

test("the lots submenu shows only in the expanded desktop sidebar", () => {
  assert.match(css, /\.site-nav\.collapsed \.nav-sub \{\s*display: none;\s*\}/);
  const phone = css.slice(css.indexOf("/* Phone */"));
  assert.match(phone, /\.site-nav \.nav-sub \{\s*display: none;\s*\}/);
});

test("Docs and Buy me a coffee are in the sidebar as plain new-tab links (coffee keeps its pill)", () => {
  const nav = readFileSync("app/SiteNav.tsx", "utf8");
  assert.match(nav, /href=\{LINKS\.docs\}/);
  assert.match(nav, /className="coffee" href=\{LINKS\.coffee\}/);
  assert.equal(nav.match(/target="_blank"/g)?.length, 2);
  assert.match(nav, /className="nav-item nav-docs"[\s\S]*<NavIcon name="github" \/>/, "Docs is a sidebar item with the GitHub logo");
  assert.doesNotMatch(nav, /<script|nofollow|LogoutButton/);
});

test("the footer's Docs and coffee links hide beside the sidebar but stay on phones and pages without it", () => {
  assert.match(css, /body:has\(\.site-nav\) \.site-footer-links \{\s*display: none;\s*\}/);
  const phone = css.slice(css.indexOf("/* Phone */"));
  assert.match(phone, /body:has\(\.site-nav\) \.site-footer-links \{\s*display: flex;\s*\}/);
  assert.match(phone, /\.site-nav \.nav-links,\s*\.site-nav \.nav-docs \{\s*display: none;\s*\}/);
});

test("Log out lives on the settings page, shown only when login is on", () => {
  const page = readFileSync("app/settings/page.tsx", "utf8");
  assert.match(page, /authMode\(process\.env\)\.mode === "on"/);
  assert.match(page, /<LogoutButton \/>/);
});

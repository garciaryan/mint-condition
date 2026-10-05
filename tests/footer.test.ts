import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const footer = readFileSync("app/SiteFooter.tsx", "utf8");
const css = readFileSync("app/globals.css", "utf8");

test("footer links to the docs (repo README) and Buy Me a Coffee in a new tab, without third-party scripts", () => {
  assert.match(footer, /href="https:\/\/github\.com\/garciaryan\/mint-condition#readme"[^>]*>\s*Docs/);
  assert.match(footer, /href="https:\/\/www\.buymeacoffee\.com\/rgarciadev"/);
  assert.equal(footer.match(/target="_blank"/g)?.length, 2);
  assert.doesNotMatch(footer, /<script|nofollow/);
});

test("footer sits at the bottom of short pages", () => {
  assert.match(css, /body \{[^}]*display: flex;[^}]*flex-direction: column;[^}]*min-height: 100dvh;/);
  assert.match(css, /\.site-footer \{[^}]*margin: auto auto 0;/);
});

test("the phone menu toggle is a bare hamburger icon with an accessible name", () => {
  const menu = readFileSync("app/SiteMenu.tsx", "utf8");
  assert.match(menu, /aria-label="Menu"/);
  assert.match(menu, /className="menu-toggle"/);
  assert.doesNotMatch(menu, />Menu</);
});

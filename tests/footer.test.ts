import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const footer = readFileSync("app/SiteFooter.tsx", "utf8");
const css = readFileSync("app/globals.css", "utf8");

test("footer links to the docs (repo README) and Buy Me a Coffee in a new tab, without third-party scripts", () => {
  assert.match(footer, /className="coffee"[\s\S]*href="https:\/\/github\.com\/garciaryan\/mint-condition#readme"/, "coffee first, then Docs");
  assert.match(footer, /<NavIcon name="github" \/>\s*<span className="sr-only">Docs \(opens in a new tab\)<\/span>/, "logo-only Docs keeps a name");
  assert.match(footer, /href="https:\/\/www\.buymeacoffee\.com\/rgarciadev"/);
  assert.equal(footer.match(/target="_blank"/g)?.length, 2);
  assert.doesNotMatch(footer, /<script|nofollow/);
});

test("footer sits at the bottom of short pages", () => {
  assert.match(css, /body \{[^}]*display: flex;[^}]*flex-direction: column;[^}]*min-height: 100dvh;/);
  assert.match(css, /\.site-footer \{[^}]*margin: auto auto 0;/);
});

test("the sidebar collapse toggle says what it will do and whether the sidebar is open", () => {
  const nav = readFileSync("app/SiteNav.tsx", "utf8");
  assert.match(nav, /aria-expanded=\{!collapsed\}/);
  assert.match(nav, /"Expand sidebar" : "Collapse sidebar"/);
});

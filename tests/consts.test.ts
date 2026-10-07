import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { LINKS, ROUTES } from "../lib/consts.ts";

test("ROUTES give today's paths", () => {
  assert.equal(ROUTES.home, "/");
  assert.equal(ROUTES.collections, "/collection");
  assert.equal(ROUTES.collection(7), "/collection/7");
  assert.equal(ROUTES.print(7), "/collection/7/print");
  assert.equal(ROUTES.settings, "/settings");
  assert.equal(ROUTES.login(), "/login");
  assert.equal(ROUTES.login("/"), "/login?next=/");
  assert.equal(ROUTES.login("/settings"), "/login?next=/settings");
});

test("LINKS", () => {
  assert.equal(LINKS.repo, "https://github.com/garciaryan/mint-condition");
  assert.equal(LINKS.docs, `${LINKS.repo}#readme`);
  assert.equal(LINKS.coffee, "https://www.buymeacoffee.com/rgarciadev");
});

function sourceFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) return sourceFiles(p);
    return /\.(ts|tsx)$/.test(name) ? [p] : [];
  });
}

test("the repo and coffee URLs are written only in lib/consts.ts", () => {
  const files = ["app", "components", "hooks", "lib"].flatMap(sourceFiles).filter((f) => f !== path.join("lib", "consts.ts"));
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    assert.ok(!src.includes("github.com/garciaryan/mint-condition"), `${f} writes out the repo URL; use LINKS`);
    assert.ok(!src.includes("buymeacoffee.com"), `${f} writes out the coffee URL; use LINKS`);
  }
});

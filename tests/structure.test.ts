import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

// The folder layout (docs/superpowers/specs/2026-10-07-folder-structure-design.md): app/ holds routes only,
// components live in components/, hooks in hooks/, and lib/ stays loadable by Node (relative imports, no UI).

function files(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name);
    return statSync(p).isDirectory() ? files(p) : [p];
  });
}
const sources = (dir: string) => files(dir).filter((f) => /\.(ts|tsx)$/.test(f));
const imports = (f: string) => [...readFileSync(f, "utf8").matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)].map((m) => m[1]);

test("app/ holds only routes", () => {
  const allowed = new Set(["page.tsx", "layout.tsx", "route.ts", "globals.css"]);
  for (const f of files("app")) assert.ok(allowed.has(path.basename(f)), `${f} belongs in components/, hooks/ or lib/`);
});

test("hooks live in hooks/", () => {
  for (const f of ["app", "components", "lib"].flatMap(sources)) {
    assert.doesNotMatch(readFileSync(f, "utf8"), /export (default )?function use[A-Z]/, `${f} defines a hook; move it to hooks/`);
  }
});

test("lib/ and app/api/ use relative imports (the tests load them in plain Node)", () => {
  for (const f of [...sources("lib"), ...sources(path.join("app", "api"))]) {
    for (const spec of imports(f)) assert.ok(!spec.startsWith("@/"), `${f} imports ${spec}`);
  }
});

test("lib/ stays free of UI imports", () => {
  for (const f of sources("lib")) {
    for (const spec of imports(f)) assert.doesNotMatch(spec, /(^|\/)(components|hooks)\//, `${f} imports ${spec}`);
  }
});

test("components and hooks never import from app/", () => {
  for (const f of [...sources("components"), ...sources("hooks")]) {
    for (const spec of imports(f)) {
      const target = spec.startsWith("@/") ? spec.slice(2) : spec.startsWith(".") ? path.normalize(path.join(path.dirname(f), spec)) : "";
      assert.ok(!target.startsWith("app/"), `${f} imports ${spec}`);
    }
  }
});

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

// Next's file conventions (routing, special and metadata files) plus stylesheets. Anything else in app/ is a component,
// hook or helper that belongs in components/, hooks/ or lib/.
const NEXT_FILE = /^(page|layout|route|loading|error|not-found|global-error|template|default)\.(tsx|ts|jsx|js)$/;
const METADATA_FILE = /^((apple-)?icon|opengraph-image|twitter-image)\d*\.\w+$|^favicon\.ico$|^(robots|sitemap|manifest)\.\w+$/;
function isRouteFile(name: string): boolean {
  return NEXT_FILE.test(name) || METADATA_FILE.test(name) || name.endsWith(".css");
}

function definesHook(src: string): boolean {
  return /export (default )?function use[A-Z]|export const use[A-Z]\w*\s*=/.test(src);
}

test("app/ holds only routes", () => {
  for (const f of files("app")) assert.ok(isRouteFile(path.basename(f)), `${f} belongs in components/, hooks/ or lib/`);
});

test("hooks live in hooks/", () => {
  for (const f of ["app", "components", "lib"].flatMap(sources)) {
    assert.ok(!definesHook(readFileSync(f, "utf8")), `${f} defines a hook; move it to hooks/`);
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

test("the app/ rule accepts Next's special and metadata files and any CSS, and nothing else", () => {
  for (const name of ["page.tsx", "layout.tsx", "route.ts", "loading.tsx", "error.tsx", "not-found.tsx", "global-error.tsx",
    "template.tsx", "default.tsx", "icon.png", "apple-icon.png", "opengraph-image.tsx", "favicon.ico", "robots.ts",
    "sitemap.ts", "manifest.ts", "globals.css", "print.css"]) {
    assert.ok(isRouteFile(name), name);
  }
  for (const name of ["GradeSelect.tsx", "useThing.ts", "api.ts", "helpers.ts", "page.helpers.ts"]) assert.ok(!isRouteFile(name), name);
});

test("the hook rule catches function and arrow-function hooks", () => {
  assert.ok(definesHook("export function useThing() {}"));
  assert.ok(definesHook("export default function useThing() {}"));
  assert.ok(definesHook("export const useThing = () => {};"));
  assert.ok(definesHook("export const useThing = function () {};"));
  assert.ok(!definesHook("export function user() {}"));
  assert.ok(!definesHook("export const usedTags = [];"));
});

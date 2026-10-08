import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { appVersion, nextAlphaTag, versionUrl } from "../lib/version.ts";

test("the first deploy of a base version is alpha.1", () => {
  assert.equal(nextAlphaTag("0.1.0", []), "v0.1.0-alpha.1");
});

test("the next tag is one past the highest, gaps and order don't matter", () => {
  assert.equal(nextAlphaTag("0.1.0", ["v0.1.0-alpha.2", "v0.1.0-alpha.10", "v0.1.0-alpha.3"]), "v0.1.0-alpha.11");
  assert.equal(nextAlphaTag("0.1.0", ["v0.1.0-alpha.1", "v0.1.0-alpha.5"]), "v0.1.0-alpha.6");
});

test("tags from other base versions and junk tags are ignored", () => {
  const tags = ["v0.0.9-alpha.40", "v0.1.0-alpha.x", "v0.1.0-alpha.", "v0.1.0", "v0.1.0-beta.7", "x0.1.0-alpha.9", "v0.1.0-alpha.2"];
  assert.equal(nextAlphaTag("0.1.0", tags), "v0.1.0-alpha.3");
  assert.equal(nextAlphaTag("0.2.0", tags), "v0.2.0-alpha.1");
});

test("a base that isn't x.y.z is refused", () => {
  for (const base of ["", "0.1", "v0.1.0", "0.1.0-alpha.1"]) assert.throws(() => nextAlphaTag(base, []), /x\.y\.z/, base);
});

test("package.json's version is a plain base version", () => {
  const { version } = JSON.parse(readFileSync("package.json", "utf8"));
  assert.doesNotThrow(() => nextAlphaTag(version, []));
});

test("appVersion is the build's tag, or dev", () => {
  assert.equal(appVersion({ NEXT_PUBLIC_APP_VERSION: "v0.1.0-alpha.3" }), "v0.1.0-alpha.3");
  assert.equal(appVersion({ NEXT_PUBLIC_APP_VERSION: "  " }), "dev");
  assert.equal(appVersion({}), "dev");
});

test("versionUrl links a tagged build to its GitHub release; dev has none", () => {
  assert.equal(versionUrl("v0.1.0-alpha.3"), "https://github.com/garciaryan/mint-condition/releases/tag/v0.1.0-alpha.3");
  assert.equal(versionUrl("dev"), null);
});

test("the Dockerfile bakes the deploy tag into the build and the running app", () => {
  const df = readFileSync("Dockerfile", "utf8");
  const build = df.slice(df.indexOf("AS build"), df.indexOf("AS run"));
  assert.match(build, /ARG APP_VERSION=dev\nENV NEXT_PUBLIC_APP_VERSION=\$APP_VERSION\n[\s\S]*RUN npm run build/);
  assert.match(df.slice(df.indexOf("AS run")), /ARG APP_VERSION=dev\nENV NEXT_PUBLIC_APP_VERSION=\$APP_VERSION/);
});

test("/settings shows the running version, linked to its release", () => {
  const page = readFileSync("app/settings/page.tsx", "utf8");
  assert.match(page, /appVersion\(process\.env\)/);
  assert.match(page, /versionUrl\(/);
  assert.match(page, /className="app-version muted small"/);
});

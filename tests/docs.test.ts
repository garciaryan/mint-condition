import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("README Get started covers both ways with the setup script, and no longer needs openssl", () => {
  const readme = readFileSync("README.md", "utf8");
  const at = readme.indexOf("## Get started");
  assert.ok(at >= 0, "missing ## Get started");
  const start = readme.slice(at, readme.indexOf("\n## ", at + 1));
  for (const s of ["npm install", "cp .env.example .env.local", "npm run dev", "fly auth login",
    "fly launch --copy-config --no-deploy", "fly volumes create mint_data", "npm run setup:fly", "fly deploy --ha=false"]) {
    assert.ok(start.includes(s), s);
  }
  assert.doesNotMatch(readme, /openssl rand/);
  assert.match(readFileSync(".env.example", "utf8"), /^# APP_PASSWORD=/m);
});

test("DEPLOY.md's secret rotation starts a stopped machine first", () => {
  const deploy = readFileSync("DEPLOY.md", "utf8");
  const at = deploy.indexOf("## 6.");
  assert.ok(deploy.indexOf("fly machine start", at) > at && deploy.indexOf("fly machine start", at) < deploy.indexOf('rm /data/session-secret', at));
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ensureSessionSecret } from "../lib/session-secret.ts";

// A data dir that doesn't exist yet, like a fresh clone or a new volume.
const freshDir = () => path.join(mkdtempSync(path.join(tmpdir(), "mc-secret-")), "data");

test("no password: nothing happens", () => {
  const dir = freshDir();
  const env: Record<string, string | undefined> = {};
  assert.equal(ensureSessionSecret(env, dir), null);
  assert.equal(existsSync(dir), false);
  assert.equal(env.SESSION_SECRET, undefined);
});

test("SESSION_SECRET in env wins and no file is written", () => {
  const dir = freshDir();
  const env: Record<string, string | undefined> = { APP_PASSWORD_HASH: "h", SESSION_SECRET: "s" };
  assert.equal(ensureSessionSecret(env, dir), "env");
  assert.equal(existsSync(path.join(dir, "session-secret")), false);
  assert.deepEqual(env, { APP_PASSWORD_HASH: "h", SESSION_SECRET: "s" });
});

test("creates a 0600 secret once and reuses it", () => {
  const dir = freshDir();
  const env: Record<string, string | undefined> = { APP_PASSWORD: "twelve chars ok" };
  assert.equal(ensureSessionSecret(env, dir), "file");
  assert.equal(Buffer.from(env.SESSION_SECRET!, "base64").length, 32);
  assert.equal(env.SESSION_SECRET_SOURCE, "file");
  assert.equal(statSync(path.join(dir, "session-secret")).mode & 0o777, 0o600);
  const again: Record<string, string | undefined> = { APP_PASSWORD: "twelve chars ok" };
  assert.equal(ensureSessionSecret(again, dir), "file");
  assert.equal(again.SESSION_SECRET, env.SESSION_SECRET);
});

test("an empty file stops startup with the path", () => {
  const dir = freshDir();
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "session-secret"), "  \n");
  assert.throws(() => ensureSessionSecret({ APP_PASSWORD: "twelve chars ok" }, dir), /session-secret.*delete it to make a new one/);
});

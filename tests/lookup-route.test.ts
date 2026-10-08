import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { signSession } from "../lib/auth.ts";
import { openDb } from "../lib/db.ts";
import { POST as lookup } from "../app/api/lookup/route.ts";

const KEYS = ["APP_PASSWORD_HASH", "SESSION_SECRET", "DISCOGS_TOKEN", "DISCOGS_USER_AGENT", "DISCOGS_CONSUMER_KEY", "DISCOGS_CONSUMER_SECRET"];
const saved = { ...process.env };
const env = process.env as Record<string, string | undefined>;
// The route reads settings from SQLite; never let a test open ./data/mint.db.
const g = globalThis as unknown as Record<string, unknown>;
before(() => {
  g.__mintDb = openDb(":memory:");
  env.APP_PASSWORD_HASH = "scrypt$16384$8$1$x$y";
  env.SESSION_SECRET = "test-secret";
  delete env.DISCOGS_TOKEN;
  delete env.DISCOGS_USER_AGENT;
});
after(() => {
  delete g.__mintDb;
  for (const k of KEYS) {
    if (saved[k] === undefined) delete env[k];
    else env[k] = saved[k];
  }
});

const call = (cookie?: string) =>
  lookup(new Request("http://localhost/api/lookup", {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: "{}",
  }));

test("lookup route rejects a request without a valid session (401 auth)", async () => {
  const r = await call();
  assert.equal(r.status, 401);
  assert.equal((await r.json()).kind, "auth");
  assert.equal((await call("mc_session=1.bad")).status, 401);
});

test("lookup route lets a signed session through to the env check", async () => {
  const v = await signSession("test-secret", Date.now());
  const r = await call(`other=1; mc_session=${v}`);
  assert.equal(r.status, 500);
  assert.equal((await r.json()).kind, "missing-env");
});

test("lookup route 503s when auth is misconfigured", async () => {
  delete env.SESSION_SECRET;
  try {
    const r = await call();
    assert.equal(r.status, 503);
    assert.equal((await r.json()).kind, "missing-env");
  } finally {
    env.SESSION_SECRET = "test-secret";
  }
});

test("lookup route reports a database that won't open as a database error", async () => {
  const savedDir = process.env.DATA_DIR;
  const db = g.__mintDb;
  delete g.__mintDb;
  process.env.DATA_DIR = "/dev/null/nope";
  env.DISCOGS_TOKEN = "dummy";
  env.DISCOGS_USER_AGENT = "dummy/1";
  try {
    const v = await signSession("test-secret", Date.now());
    const r = await call(`mc_session=${v}`);
    assert.equal(r.status, 500);
    const b = await r.json();
    assert.equal(b.kind, "database");
  } finally {
    if (savedDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = savedDir;
    delete env.DISCOGS_TOKEN;
    delete env.DISCOGS_USER_AGENT;
    g.__mintDb = db;
  }
});

test("lookup route with consumer vars and no connection gives not-connected (409)", async () => {
  env.DISCOGS_USER_AGENT = "dummy/1";
  env.DISCOGS_CONSUMER_KEY = "ck";
  env.DISCOGS_CONSUMER_SECRET = "cs";
  try {
    const v = await signSession("test-secret", Date.now());
    const r = await call(`mc_session=${v}`);
    assert.equal(r.status, 409);
    assert.equal((await r.json()).kind, "not-connected");
  } finally {
    delete env.DISCOGS_USER_AGENT;
    delete env.DISCOGS_CONSUMER_KEY;
    delete env.DISCOGS_CONSUMER_SECRET;
  }
});

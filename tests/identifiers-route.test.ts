import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { signSession } from "../lib/auth.ts";
import { openDb } from "../lib/db.ts";
import { DiscogsError, parseReleaseStats } from "../lib/discogs.ts";
import { httpStatus } from "../lib/lookup.ts";
import type { MarketplaceStats } from "../lib/types.ts";
import { GET as identifiers } from "../app/api/releases/[id]/identifiers/route.ts";

const KEYS = ["APP_PASSWORD_HASH", "SESSION_SECRET", "DISCOGS_TOKEN", "DISCOGS_USER_AGENT", "DISCOGS_CONSUMER_KEY", "DISCOGS_CONSUMER_SECRET"];
const saved = { ...process.env };
const env = process.env as Record<string, string | undefined>;
const g = globalThis as unknown as Record<string, unknown>;
const RELEASE = parseReleaseStats(JSON.parse(readFileSync("tests/fixtures/release-5193282.json", "utf8")));
let calls = 0;
let answer: () => MarketplaceStats = () => RELEASE;
let cookie = "";

before(async () => {
  env.APP_PASSWORD_HASH = "scrypt$16384$8$1$x$y";
  env.SESSION_SECRET = "test-secret";
  env.DISCOGS_TOKEN = "dummy";
  env.DISCOGS_USER_AGENT = "dummy/1";
  cookie = `mc_session=${await signSession("test-secret", Date.now())}`;
  g.__discogsClient = { async releaseStats() { calls++; return answer(); } };
});
beforeEach(() => {
  g.__mintDb = openDb(":memory:");
  calls = 0;
  answer = () => RELEASE;
  env.DISCOGS_TOKEN = "dummy";
});
after(() => {
  delete g.__mintDb;
  delete g.__discogsClient;
  for (const k of KEYS) {
    if (saved[k] === undefined) delete env[k];
    else env[k] = saved[k];
  }
});

const get = (id: string, withCookie = true) =>
  identifiers(new Request(`http://localhost/api/releases/${id}/identifiers`, { headers: withCookie ? { cookie } : {} }), {
    params: Promise.resolve({ id }),
  });

test("needs a session", async () => {
  assert.equal((await get("5193282", false)).status, 401);
});

test("a bad id is 400 and never reaches Discogs", async () => {
  for (const id of ["abc", "-1", "1.5"]) assert.equal((await get(id)).status, 400, id);
  assert.equal(calls, 0);
});

test("returns the release's identifiers, from the cache the second time", async () => {
  const r = await get("5193282");
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.identifiers.length, 5);
  assert.equal(typeof body.fetchedAt, "number");
  assert.equal((await get("5193282")).status, 200);
  assert.equal(calls, 1);
});

test("a release Discogs doesn't have gives no identifiers", async () => {
  answer = () => ({ lowestPrice: null, currency: null, numForSale: 0 });
  assert.deepEqual((await (await get("7")).json()).identifiers, []);
});

test("Discogs errors map like the lookup route", async () => {
  answer = () => { throw new DiscogsError("slow down", 429); };
  const r = await get("8");
  const body = await r.json();
  assert.equal(body.kind, "rate-limited");
  assert.equal(r.status, httpStatus({ status: "error", kind: "rate-limited", message: "" }));
});

test("missing env is reported, not thrown", async () => {
  delete env.DISCOGS_TOKEN;
  const r = await get("9");
  assert.equal((await r.json()).kind, "missing-env");
});

test("consumer vars without a connection give not-connected (409)", async () => {
  delete env.DISCOGS_TOKEN;
  env.DISCOGS_CONSUMER_KEY = "ck";
  env.DISCOGS_CONSUMER_SECRET = "cs";
  try {
    const r = await get("5193282");
    assert.equal(r.status, 409);
    assert.equal((await r.json()).kind, "not-connected");
    assert.equal(calls, 0);
  } finally {
    delete env.DISCOGS_CONSUMER_KEY;
    delete env.DISCOGS_CONSUMER_SECRET;
  }
});

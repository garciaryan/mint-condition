import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { signSession } from "../lib/auth.ts";
import { openDb } from "../lib/db.ts";
import { DiscogsError } from "../lib/discogs.ts";
import type { MasterVersions } from "../lib/discogs.ts";
import { httpStatus } from "../lib/lookup.ts";
import type { Candidate } from "../lib/types.ts";
import { GET as versions } from "../app/api/masters/[id]/versions/route.ts";

const KEYS = ["APP_PASSWORD_HASH", "SESSION_SECRET", "DISCOGS_TOKEN", "DISCOGS_USER_AGENT", "DISCOGS_CONSUMER_KEY", "DISCOGS_CONSUMER_SECRET"];
const saved = { ...process.env };
const env = process.env as Record<string, string | undefined>;
const g = globalThis as unknown as Record<string, unknown>;
const cand = (id: number, year: number | null): Candidate => ({ id, title: "Blue Train", year, country: "US", label: "Blue Note", catno: "BLP 1577", format: "LP", thumb: null });
const VERSIONS: MasterVersions = { versions: [cand(5193282, 1958), cand(1, 1972)], total: 199 };
let calls = 0;
let answer: () => MasterVersions = () => VERSIONS;
let cookie = "";

before(async () => {
  env.APP_PASSWORD_HASH = "scrypt$16384$8$1$x$y";
  env.SESSION_SECRET = "test-secret";
  env.DISCOGS_TOKEN = "dummy";
  env.DISCOGS_USER_AGENT = "dummy/1";
  cookie = `mc_session=${await signSession("test-secret", Date.now())}`;
  g.__discogsClient = { async masterVersions() { calls++; return answer(); } };
});
beforeEach(() => {
  g.__mintDb = openDb(":memory:");
  calls = 0;
  answer = () => VERSIONS;
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
  versions(new Request(`http://localhost/api/masters/${id}/versions`, { headers: withCookie ? { cookie } : {} }), {
    params: Promise.resolve({ id }),
  });

test("needs a session", async () => {
  assert.equal((await get("32208", false)).status, 401);
});

test("a bad id is 400 and never reaches Discogs", async () => {
  for (const id of ["abc", "-1", "1.5"]) assert.equal((await get(id)).status, 400, id);
  assert.equal(calls, 0);
});

test("returns the master's versions, from the cache the second time", async () => {
  const r = await get("32208");
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.deepEqual(body.versions, VERSIONS.versions);
  assert.equal(body.total, 199);
  assert.equal(typeof body.fetchedAt, "number");
  assert.equal((await get("32208")).status, 200);
  assert.equal(calls, 1);
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
    const r = await get("9");
    assert.equal(r.status, 409);
    assert.equal((await r.json()).kind, "not-connected");
    assert.equal(calls, 0);
  } finally {
    delete env.DISCOGS_CONSUMER_KEY;
    delete env.DISCOGS_CONSUMER_SECRET;
  }
});

import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { signSession } from "../lib/auth.ts";
import { openDb } from "../lib/db.ts";
import { getConnection, saveConnection, savePending, PENDING_MAX_MS } from "../lib/discogs-auth-store.ts";
import { ConnectSetupError, finishConnect, startConnect } from "../lib/discogs-connect.ts";
import type { ConnectDeps } from "../lib/discogs-connect.ts";
import { addItems, createSession, getItem } from "../lib/collection/store.ts";
import { __resetWorkerForTests, isQueuePaused } from "../lib/collection/worker.ts";
import { POST as connectRoute } from "../app/api/discogs/connect/route.ts";
import { GET as callbackRoute } from "../app/api/discogs/callback/route.ts";
import { POST as disconnectRoute } from "../app/api/discogs/disconnect/route.ts";

const NOW = 1_800_000_000_000;
const OAUTH_ENV = { DISCOGS_CONSUMER_KEY: "ck", DISCOGS_CONSUMER_SECRET: "cs", DISCOGS_USER_AGENT: "MintCondition/1" };

type Call = { url: string; method: string; headers: Headers };
type Answers = { requestToken?: Response; accessToken?: Response; identity?: Response };

function fakeFetch(calls: Call[], answers: Answers = {}): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, method: init?.method ?? "GET", headers: new Headers(init?.headers) });
    if (url === "https://api.discogs.com/oauth/request_token")
      return answers.requestToken ?? new Response("oauth_token=rt&oauth_token_secret=rs&oauth_callback_confirmed=true");
    if (url === "https://api.discogs.com/oauth/access_token")
      return answers.accessToken ?? new Response("oauth_token=at&oauth_token_secret=as");
    if (url === "https://api.discogs.com/oauth/identity")
      return answers.identity ?? Response.json({ id: 1, username: "groovyrecords", resource_url: "x", consumer_name: "Mint" });
    throw new Error(`unexpected fetch ${url}`);
  }) as typeof fetch;
}

let db: DatabaseSync;
let calls: Call[];
const deps = (o: Partial<ConnectDeps> = {}): ConnectDeps => ({
  db,
  env: OAUTH_ENV,
  fetchImpl: fakeFetch(calls),
  now: () => NOW,
  nonce: () => "n0nce",
  userAgent: "MintCondition/1",
  ...o,
});
const cacheRows = () => (db.prepare("SELECT COUNT(*) AS n FROM discogs_cache").get() as { n: number }).n;
const putCache = () =>
  db.prepare("INSERT INTO discogs_cache (key, json, fetched_at) VALUES ('release:1', '{}', 1)").run();
const pendingRow = () =>
  db.prepare("SELECT pending_token, pending_secret, pending_at FROM discogs_auth WHERE id = 1").get() as
    | { pending_token: string | null; pending_secret: string | null; pending_at: number | null }
    | undefined;
const q = (s: string) => new URLSearchParams(s);

beforeEach(() => {
  db = openDb(":memory:");
  calls = [];
});

// ---- startConnect

test("connect: gets a request token with our callback, saves it pending, sends the browser to authorize", async () => {
  const r = await startConnect(deps(), "shop.fly.dev", "https");
  assert.deepEqual(r, { location: "https://www.discogs.com/oauth/authorize?oauth_token=rt" });
  assert.equal(calls.length, 1);
  const c = calls[0];
  assert.equal(c.method, "POST");
  assert.equal(c.headers.get("user-agent"), "MintCondition/1");
  const auth = c.headers.get("authorization") ?? "";
  assert.match(auth, /^OAuth /);
  assert.match(auth, /oauth_consumer_key="ck"/);
  assert.match(auth, /oauth_callback="https%3A%2F%2Fshop.fly.dev%2Fapi%2Fdiscogs%2Fcallback"/);
  assert.match(auth, /oauth_nonce="n0nce"/);
  assert.match(auth, new RegExp(`oauth_timestamp="${Math.floor(NOW / 1000)}"`));
  assert.doesNotMatch(auth, /oauth_token=/);
  assert.deepEqual({ ...pendingRow() }, { pending_token: "rt", pending_secret: "rs", pending_at: NOW });
});

test("connect: plain-http localhost gets an http callback", async () => {
  await startConnect(deps(), "localhost:3000", "http");
  assert.match(calls[0].headers.get("authorization") ?? "", /oauth_callback="http%3A%2F%2Flocalhost%3A3000%2Fapi%2Fdiscogs%2Fcallback"/);
});

test("connect: token mode goes straight back to settings with no Discogs call", async () => {
  const r = await startConnect(deps({ env: { ...OAUTH_ENV, DISCOGS_TOKEN: "pat" } }), "shop.fly.dev", "https");
  assert.deepEqual(r, { location: "/settings" });
  assert.equal(calls.length, 0);
});

test("connect: missing consumer vars throws a setup error naming them, never values", async () => {
  for (const env of [{ DISCOGS_USER_AGENT: "ua" }, { DISCOGS_CONSUMER_KEY: "ck", DISCOGS_CONSUMER_SECRET: "cs" }]) {
    await assert.rejects(startConnect(deps({ env }), "shop.fly.dev", "https"), (e: unknown) => {
      assert.ok(e instanceof ConnectSetupError);
      assert.equal(e.kind, "setup");
      assert.match(e.message, /DISCOGS_/);
      assert.doesNotMatch(e.message, /\bck\b|\bcs\b/);
      return true;
    });
  }
  assert.equal(calls.length, 0);
});

test("connect: a Discogs error goes to settings with discogs=error and saves nothing", async () => {
  for (const requestToken of [new Response("nope", { status: 500 }), new Response("oauth_callback_confirmed=true")]) {
    calls = [];
    const r = await startConnect(deps({ fetchImpl: fakeFetch(calls, { requestToken }) }), "shop.fly.dev", "https");
    assert.deepEqual(r, { location: "/settings?discogs=error" });
    assert.equal(pendingRow()?.pending_token ?? null, null);
  }
  const thrower = (async () => { throw new TypeError("network down"); }) as unknown as typeof fetch;
  assert.deepEqual(await startConnect(deps({ fetchImpl: thrower }), "shop.fly.dev", "https"), { location: "/settings?discogs=error" });
});

// ---- finishConnect

test("callback: exchanges the verifier, reads the username, saves the connection and clears the cache", async () => {
  savePending(db, "rt", "rs", NOW - 1000);
  putCache();
  const r = await finishConnect(deps(), q("oauth_token=rt&oauth_verifier=ver1"));
  assert.deepEqual(r, { location: "/settings?discogs=connected" });
  assert.deepEqual(getConnection(db), { token: "at", secret: "as", username: "groovyrecords", connectedAt: NOW });
  assert.equal(cacheRows(), 0);
  assert.equal(pendingRow()?.pending_token, null);
  assert.equal(calls.length, 2);
  const [ex, id] = calls;
  assert.equal(ex.url, "https://api.discogs.com/oauth/access_token");
  assert.equal(ex.method, "POST");
  assert.match(ex.headers.get("authorization") ?? "", /oauth_token="rt"/);
  assert.match(ex.headers.get("authorization") ?? "", /oauth_verifier="ver1"/);
  assert.equal(ex.headers.get("user-agent"), "MintCondition/1");
  assert.equal(id.url, "https://api.discogs.com/oauth/identity");
  assert.equal(id.method, "GET");
  assert.match(id.headers.get("authorization") ?? "", /oauth_token="at"/);
  assert.doesNotMatch(id.headers.get("authorization") ?? "", /oauth_verifier/);
  assert.equal(id.headers.get("user-agent"), "MintCondition/1");
});

test("callback: denied goes to discogs=denied, clears the pending sign-in, saves nothing", async () => {
  savePending(db, "rt", "rs", NOW - 1000);
  assert.deepEqual(await finishConnect(deps(), q("denied=rt")), { location: "/settings?discogs=denied" });
  assert.equal(getConnection(db), null);
  assert.equal(pendingRow()?.pending_token, null);
  assert.equal(calls.length, 0);
});

test("callback: a mismatched token is an error and saves nothing", async () => {
  savePending(db, "rt", "rs", NOW - 1000);
  assert.deepEqual(await finishConnect(deps(), q("oauth_token=other&oauth_verifier=v")), { location: "/settings?discogs=error" });
  assert.equal(getConnection(db), null);
  assert.equal(calls.length, 0);
  // the pending sign-in is used up either way
  assert.deepEqual(await finishConnect(deps(), q("oauth_token=rt&oauth_verifier=v")), { location: "/settings?discogs=error" });
});

test("callback: a pending sign-in older than 10 minutes is an error", async () => {
  savePending(db, "rt", "rs", NOW - PENDING_MAX_MS - 1);
  assert.deepEqual(await finishConnect(deps(), q("oauth_token=rt&oauth_verifier=v")), { location: "/settings?discogs=error" });
  assert.equal(getConnection(db), null);
  assert.equal(calls.length, 0);
});

test("callback: a token without a verifier uses up the pending sign-in", async () => {
  savePending(db, "rt", "rs", NOW - 1000);
  assert.deepEqual(await finishConnect(deps(), q("oauth_token=rt")), { location: "/settings?discogs=error" });
  assert.equal(pendingRow()?.pending_token, null);
});

test("callback: missing token or verifier, or no pending sign-in, is an error", async () => {
  for (const s of ["", "oauth_token=rt", "oauth_verifier=v"]) {
    savePending(db, "rt", "rs", NOW - 1000);
    assert.deepEqual(await finishConnect(deps(), q(s)), { location: "/settings?discogs=error" }, s);
  }
  db = openDb(":memory:"); // no pending sign-in at all
  assert.deepEqual(await finishConnect(deps(), q("oauth_token=rt&oauth_verifier=v")), { location: "/settings?discogs=error" });
  assert.equal(calls.length, 0);
});

test("callback: Discogs failures are an error and save nothing; an existing connection stays", async () => {
  const bad: Answers[] = [
    { accessToken: new Response("oops", { status: 500 }) },
    { accessToken: new Response("oauth_token=at") },
    { identity: new Response("{}", { status: 401 }) },
    { identity: Response.json({ id: 1 }) },
    { identity: new Response("not json") },
  ];
  for (const answers of bad) {
    saveConnection(db, { token: "old", secret: "olds", username: "before", connectedAt: 1 });
    savePending(db, "rt", "rs", NOW - 1000);
    putCache();
    calls = [];
    const r = await finishConnect(deps({ fetchImpl: fakeFetch(calls, answers) }), q("oauth_token=rt&oauth_verifier=v"));
    assert.deepEqual(r, { location: "/settings?discogs=error" }, JSON.stringify(Object.keys(answers)));
    assert.equal(getConnection(db)?.username, "before");
    assert.equal(cacheRows(), 1);
    db.exec("DELETE FROM discogs_cache");
  }
});

test("callback: consumer vars missing is an error", async () => {
  savePending(db, "rt", "rs", NOW - 1000);
  const r = await finishConnect(deps({ env: { DISCOGS_USER_AGENT: "ua" } }), q("oauth_token=rt&oauth_verifier=v"));
  assert.deepEqual(r, { location: "/settings?discogs=error" });
  assert.equal(calls.length, 0);
});

// ---- routes

const KEYS = ["APP_PASSWORD_HASH", "SESSION_SECRET", "DISCOGS_TOKEN", "DISCOGS_USER_AGENT", "DISCOGS_CONSUMER_KEY", "DISCOGS_CONSUMER_SECRET", "NODE_ENV"];
const saved = { ...process.env };
const env = process.env as Record<string, string | undefined>;
const g = globalThis as unknown as Record<string, unknown>;
const realFetch = globalThis.fetch;
let cookie = "";

before(async () => {
  env.APP_PASSWORD_HASH = "scrypt$16384$8$1$x$y";
  env.SESSION_SECRET = "test-secret";
  cookie = `mc_session=${await signSession("test-secret", Date.now())}`;
  // the worker kicked after a connect finds no pending items; a stub client keeps it off the network anyway
  g.__discogsClient = {};
});
after(() => {
  delete g.__mintDb;
  delete g.__discogsClient;
  globalThis.fetch = realFetch;
  for (const k of KEYS) {
    if (saved[k] === undefined) delete env[k];
    else env[k] = saved[k];
  }
});

function routeSetup() {
  g.__mintDb = db;
  delete env.DISCOGS_TOKEN;
  Object.assign(env, OAUTH_ENV);
  globalThis.fetch = fakeFetch(calls);
}

const headers = (withCookie: boolean, extra: Record<string, string> = {}) => ({ ...(withCookie ? { cookie } : {}), ...extra });

test("routes: each needs a session", async () => {
  routeSetup();
  const post = (u: string) => new Request(u, { method: "POST", headers: headers(false) });
  assert.equal((await connectRoute(post("http://x/api/discogs/connect"))).status, 401);
  assert.equal((await callbackRoute(new Request("http://x/api/discogs/callback?oauth_token=rt&oauth_verifier=v"))).status, 401);
  assert.equal((await disconnectRoute(post("http://x/api/discogs/disconnect"))).status, 401);
  assert.equal(calls.length, 0);
});

test("connect route: 303 to authorize with a callback from host and x-forwarded-proto", async () => {
  routeSetup();
  const r = await connectRoute(new Request("http://internal:3000/api/discogs/connect", {
    method: "POST",
    headers: headers(true, { host: "shop.fly.dev", "x-forwarded-proto": "https" }),
  }));
  assert.equal(r.status, 303);
  assert.equal(r.headers.get("location"), "https://www.discogs.com/oauth/authorize?oauth_token=rt");
  assert.match(calls[0].headers.get("authorization") ?? "", /oauth_callback="https%3A%2F%2Fshop.fly.dev%2Fapi%2Fdiscogs%2Fcallback"/);
  assert.equal(pendingRow()?.pending_token, "rt");
});

test("connect route: missing consumer vars 303s to discogs=error and logs the names, never values", async () => {
  routeSetup();
  delete env.DISCOGS_CONSUMER_KEY;
  const logged: string[] = [];
  const warn = console.warn;
  console.warn = (...a: unknown[]) => void logged.push(a.map(String).join(" "));
  try {
    const r = await connectRoute(new Request("http://x/api/discogs/connect", { method: "POST", headers: headers(true, { host: "x" }) }));
    assert.equal(r.status, 303);
    assert.equal(r.headers.get("location"), "/settings?discogs=error");
  } finally {
    console.warn = warn;
  }
  assert.match(logged.join("\n"), /DISCOGS_CONSUMER_KEY/);
  assert.doesNotMatch(logged.join("\n"), /\bcs\b|\bck\b/);
  assert.equal(calls.length, 0);
});

test("connect route: a database error 303s to discogs=error", async () => {
  routeSetup();
  delete g.__mintDb;
  const prevDir = env.DATA_DIR;
  env.DATA_DIR = "/dev/null/nope";
  try {
    const r = await connectRoute(new Request("http://x/api/discogs/connect", { method: "POST", headers: headers(true, { host: "x" }) }));
    assert.equal(r.status, 303);
    assert.equal(r.headers.get("location"), "/settings?discogs=error");
  } finally {
    if (prevDir === undefined) delete env.DATA_DIR; else env.DATA_DIR = prevDir;
    delete g.__mintDb;
  }
});

test("callback route: success saves the connection and 303s to discogs=connected", async () => {
  routeSetup();
  savePending(db, "rt", "rs", Date.now() - 1000);
  const r = await callbackRoute(new Request("http://x/api/discogs/callback?oauth_token=rt&oauth_verifier=v", { headers: headers(true) }));
  assert.equal(r.status, 303);
  assert.equal(r.headers.get("location"), "/settings?discogs=connected");
  assert.equal(getConnection(db)?.username, "groovyrecords");
  const text = await r.text();
  assert.doesNotMatch(text, /\bat\b|\bas\b/);
});

test("callback route: a successful connect resumes a paused queue and kicks the worker", async () => {
  routeSetup();
  const w = globalThis as unknown as { __mintWorker?: { loop: Promise<void> | null; paused: boolean } };
  __resetWorkerForTests();
  const s = createSession(db, { name: "L", defaultRecord: "NM", defaultSleeve: "NM" }, 100);
  const [item] = addItems(db, s.id, [{ query: "A" }], { record: "VG+", sleeve: "VG" }, 100);
  w.__mintWorker!.paused = true; // as after a revoked connection's 401
  const prevClient = g.__discogsClient;
  g.__discogsClient = {
    async searchByCatno() { return [{ id: 7, title: "T", year: 1970, country: "US", label: "L", catno: "A", format: "LP", thumb: null }]; },
    async priceSuggestions() { return { "VG+": 20 }; },
    async releaseStats() { return { lowestPrice: 9, currency: "USD", numForSale: 4 }; },
  };
  try {
    savePending(db, "rt", "rs", Date.now() - 1000);
    const r = await callbackRoute(new Request("http://x/api/discogs/callback?oauth_token=rt&oauth_verifier=v", { headers: headers(true) }));
    assert.equal(r.headers.get("location"), "/settings?discogs=connected");
    assert.equal(isQueuePaused(), false);
    assert.ok(w.__mintWorker?.loop, "the worker was kicked");
    await w.__mintWorker!.loop;
    assert.equal(getItem(db, item.id)?.status, "priced");
  } finally {
    g.__discogsClient = prevClient;
    __resetWorkerForTests();
  }
});

test("callback route: denied 303s to discogs=denied", async () => {
  routeSetup();
  const r = await callbackRoute(new Request("http://x/api/discogs/callback?denied=rt", { headers: headers(true) }));
  assert.equal(r.status, 303);
  assert.equal(r.headers.get("location"), "/settings?discogs=denied");
});

test("disconnect route: clears the connection and 303s to discogs=disconnected", async () => {
  routeSetup();
  saveConnection(db, { token: "at", secret: "as", username: "groovyrecords", connectedAt: 1 });
  putCache();
  const r = await disconnectRoute(new Request("http://x/api/discogs/disconnect", { method: "POST", headers: headers(true) }));
  assert.equal(r.status, 303);
  assert.equal(r.headers.get("location"), "/settings?discogs=disconnected");
  assert.equal(getConnection(db), null);
  assert.equal(cacheRows(), 0);
});

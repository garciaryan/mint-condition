import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../lib/db.ts";
import { saveConnection } from "../lib/discogs-auth-store.ts";
import { GET } from "../app/api/health/route.ts";

test("health names where the session secret comes from, never its value", async () => {
  const env = process.env as Record<string, string | undefined>;
  const saved = { s: env.SESSION_SECRET, src: env.SESSION_SECRET_SOURCE };
  env.SESSION_SECRET = "health-test-secret-value";
  env.SESSION_SECRET_SOURCE = "file";
  try {
    const text = await (await GET()).text();
    assert.equal(JSON.parse(text).sessionSecretSource, "file");
    assert.doesNotMatch(text, /health-test-secret-value/);
  } finally {
    for (const [k, v] of [["SESSION_SECRET", saved.s], ["SESSION_SECRET_SOURCE", saved.src]] as const) {
      if (v === undefined) delete env[k];
      else env[k] = v;
    }
  }
});

test("health reports the running version", async () => {
  const env = process.env as Record<string, string | undefined>;
  const saved = env.NEXT_PUBLIC_APP_VERSION;
  try {
    env.NEXT_PUBLIC_APP_VERSION = "v0.1.0-alpha.4";
    assert.equal((await (await GET()).json()).version, "v0.1.0-alpha.4");
    delete env.NEXT_PUBLIC_APP_VERSION;
    assert.equal((await (await GET()).json()).version, "dev");
  } finally {
    if (saved === undefined) delete env.NEXT_PUBLIC_APP_VERSION;
    else env.NEXT_PUBLIC_APP_VERSION = saved;
  }
});

const DISCOGS_KEYS = ["DISCOGS_TOKEN", "DISCOGS_USER_AGENT", "DISCOGS_CONSUMER_KEY", "DISCOGS_CONSUMER_SECRET"];
async function withDiscogs(vars: Record<string, string>, fn: (g: Record<string, unknown>) => Promise<void>) {
  const env = process.env as Record<string, string | undefined>;
  const g = globalThis as unknown as Record<string, unknown>;
  const saved = DISCOGS_KEYS.map((k) => env[k]);
  const prevDb = g.__mintDb;
  for (const k of DISCOGS_KEYS) delete env[k];
  Object.assign(env, vars);
  g.__mintDb = openDb(":memory:");
  try {
    await fn(g);
  } finally {
    DISCOGS_KEYS.forEach((k, i) => (saved[i] === undefined ? delete env[k] : (env[k] = saved[i])));
    if (prevDb === undefined) delete g.__mintDb; else g.__mintDb = prevDb;
  }
}

test("health: consumer vars without a connection is ok and not-connected", async () => {
  await withDiscogs({ DISCOGS_USER_AGENT: "ua/1", DISCOGS_CONSUMER_KEY: "ck-public", DISCOGS_CONSUMER_SECRET: "consumer-secret-value" }, async () => {
    const r = await GET();
    const text = await r.text();
    assert.equal(r.status, 200);
    const b = JSON.parse(text);
    assert.equal(b.ok, true);
    assert.equal(b.discogs, "not-connected");
    assert.doesNotMatch(text, /consumer-secret-value/);
  });
});

test("health: connected, and never the username", async () => {
  await withDiscogs({ DISCOGS_USER_AGENT: "ua/1", DISCOGS_CONSUMER_KEY: "ck", DISCOGS_CONSUMER_SECRET: "cs" }, async (g) => {
    saveConnection(g.__mintDb as ReturnType<typeof openDb>, { token: "tok", secret: "sec", username: "record-shop-guy", connectedAt: 1 });
    const text = await (await GET()).text();
    assert.equal(JSON.parse(text).discogs, "connected");
    assert.doesNotMatch(text, /record-shop-guy|"tok"|"sec"/);
  });
});

test("health: a token reports token; nothing set is 503 setup", async () => {
  await withDiscogs({ DISCOGS_USER_AGENT: "ua/1", DISCOGS_TOKEN: "t" }, async () => {
    assert.equal((await (await GET()).json()).discogs, "token");
  });
  await withDiscogs({}, async () => {
    const r = await GET();
    assert.equal(r.status, 503);
    assert.equal((await r.json()).discogs, "setup");
  });
});

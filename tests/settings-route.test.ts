import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { signSession } from "../lib/auth.ts";
import { openDb } from "../lib/db.ts";
import { __setSettingsPathForTests } from "../lib/settings-store.ts";
import { DELETE, GET, PUT } from "../app/api/settings/route.ts";

const KEYS = ["APP_PASSWORD_HASH", "SESSION_SECRET"];
const saved = { ...process.env };
const env = process.env as Record<string, string | undefined>;
const g = globalThis as unknown as Record<string, unknown>;
let cookie = "";

before(async () => {
  env.APP_PASSWORD_HASH = "scrypt$16384$8$1$x$y";
  env.SESSION_SECRET = "test-secret";
  cookie = `mc_session=${await signSession("test-secret", Date.now())}`;
});
after(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete env[k];
    else env[k] = saved[k];
  }
  delete g.__mintDb;
  __setSettingsPathForTests(null);
});
beforeEach(() => {
  g.__mintDb = openDb(":memory:");
  __setSettingsPathForTests(null);
});

const req = (method: string, body?: unknown, withCookie = true) =>
  new Request("http://localhost/api/settings", {
    method,
    headers: { ...(withCookie ? { cookie } : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}) },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
// biome-ignore lint: test helper
const j = async (r: Response): Promise<any> => r.json();

test("GET returns defaults when nothing is saved", async () => {
  const b = await j(await GET(req("GET")));
  assert.equal(b.saved, false);
  assert.deepEqual(b.settings, b.defaults);
  assert.equal(b.invalid, null);
  assert.equal(b.savedRaw, null);
  assert.equal(b.updatedAt, null);
});

test("PUT saves and GET reflects it; DELETE resets", async () => {
  const cur = (await j(await GET(req("GET")))).settings;
  const r = await PUT(req("PUT", { ...cur, offer: { ...cur.offer, marginPercent: 35 } }));
  assert.equal(r.status, 200);
  assert.equal((await j(r)).settings.offer.marginPercent, 35);
  const after = await j(await GET(req("GET")));
  assert.equal(after.settings.offer.marginPercent, 35);
  assert.equal(after.saved, true);
  const d = await DELETE(req("DELETE"));
  assert.equal(d.status, 200);
  const reset = await j(d);
  assert.equal(reset.saved, false);
  assert.equal(reset.settings.offer.marginPercent, reset.defaults.offer.marginPercent);
});

test("PUT with a string number is a 400 naming the field and stores nothing", async () => {
  const cur = (await j(await GET(req("GET")))).settings;
  const r = await PUT(req("PUT", { ...cur, local: { ...cur.local, localDiscountMultiplier: "0.8" } }));
  assert.equal(r.status, 400);
  const b = await j(r);
  assert.equal(b.kind, "bad-request");
  assert.equal(b.field, "local.localDiscountMultiplier");
  assert.equal((await j(await GET(req("GET")))).saved, false);
});

test("PUT with a bad sleeve value names the VG+ field", async () => {
  const r = await PUT(req("PUT", { sleeveMultipliers: { "VG+": 0 } }));
  assert.equal(r.status, 400);
  assert.equal((await j(r)).field, "sleeveMultipliers.VG+");
});

test("a PUT error with no form field has no field", async () => {
  const r = await PUT(req("PUT", { offer: null }));
  assert.equal(r.status, 400);
  assert.equal((await j(r)).field, undefined);
});

test("PUT rejects a non-object body and bad JSON", async () => {
  assert.equal((await PUT(req("PUT", [1]))).status, 400);
  assert.equal((await PUT(req("PUT", "{bad"))).status, 400);
});

test("every handler 401s without a session", async () => {
  assert.equal((await GET(req("GET", undefined, false))).status, 401);
  assert.equal((await PUT(req("PUT", {}, false))).status, 401);
  assert.equal((await DELETE(req("DELETE", undefined, false))).status, 401);
});

test("GET returns savedRaw when the stored row is invalid", async () => {
  (g.__mintDb as DatabaseSync).prepare("insert into settings (id, json, updated_at) values (1, ?, 1)")
    .run(JSON.stringify({ offer: { openingPercent: 45 } }));
  const b = await j(await GET(req("GET")));
  assert.match(b.invalid, /openingPercent/);
  assert.equal(b.savedRaw.offer.openingPercent, 45);
  assert.deepEqual(b.settings, b.defaults);
});

test("an invalid settings.json is a 500 settings error", async () => {
  __setSettingsPathForTests("/nonexistent/settings.json");
  const r = await GET(req("GET"));
  assert.equal(r.status, 500);
  assert.equal((await j(r)).kind, "settings");
  assert.equal((await PUT(req("PUT", {}))).status, 500);
  assert.equal((await DELETE(req("DELETE"))).status, 500);
});

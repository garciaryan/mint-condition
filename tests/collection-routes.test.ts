import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { signSession } from "../lib/auth.ts";
import { openDb } from "../lib/db.ts";
import { __setSettingsPathForTests } from "../lib/collection/http.ts";
import { saveSettings } from "../lib/settings-store.ts";
import { __resetWorkerForTests, isQueuePaused, kickWorker } from "../lib/collection/worker.ts";
import { DiscogsError } from "../lib/discogs.ts";
import type { LookupClient } from "../lib/lookup.ts";
import type { Candidate, MarketplaceStats, PriceSuggestions } from "../lib/types.ts";
import { GET as listSessions, POST as createSession } from "../app/api/sessions/route.ts";
import { GET as getSession, PATCH as patchSession, DELETE as deleteSession } from "../app/api/sessions/[id]/route.ts";
import { POST as addItems } from "../app/api/sessions/[id]/items/route.ts";
import { POST as reprice } from "../app/api/sessions/[id]/reprice/route.ts";
import { PATCH as patchItem, DELETE as deleteItem } from "../app/api/items/[id]/route.ts";
import { POST as resumeSession } from "../app/api/sessions/[id]/resume/route.ts";
import { POST as retryItem } from "../app/api/items/[id]/retry/route.ts";
import { GET as getCandidates } from "../app/api/items/[id]/candidates/route.ts";
import { GET as exportCsv } from "../app/api/sessions/[id]/discogs.csv/route.ts";

const KEYS = ["APP_PASSWORD_HASH", "SESSION_SECRET", "DISCOGS_TOKEN", "DISCOGS_USER_AGENT"];
const saved = { ...process.env };
const env = process.env as Record<string, string | undefined>;
const g = globalThis as unknown as Record<string, unknown>;
let cookie = "";

const cand = (id: number): Candidate => ({ id, title: `T${id}`, year: 1971, country: "US", label: "L", catno: "C", format: "LP", thumb: null });
const STATS: MarketplaceStats = { lowestPrice: 9, currency: "USD", numForSale: 4 };
const SUG: PriceSuggestions = { NM: 30, "VG+": 20, VG: 10 };
let searchFn: (q: string) => Candidate[] = () => [cand(1)];
let suggFn: (id: number) => PriceSuggestions | null = () => SUG;
const fakeClient: LookupClient = {
  async searchByCatno(q) { return searchFn(q); },
  async priceSuggestions(id) { return suggFn(id); },
  async marketplaceStats() { return STATS; },
};

before(async () => {
  env.APP_PASSWORD_HASH = "scrypt$16384$8$1$x$y";
  env.SESSION_SECRET = "test-secret";
  env.DISCOGS_TOKEN = "dummy";
  env.DISCOGS_USER_AGENT = "dummy/1";
  cookie = `mc_session=${await signSession("test-secret", Date.now())}`;
  g.__discogsClient = fakeClient;
});
after(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete env[k];
    else env[k] = saved[k];
  }
  delete g.__discogsClient;
  delete g.__mintDb;
  __setSettingsPathForTests(null);
});
beforeEach(() => {
  g.__mintDb = openDb(":memory:");
  __resetWorkerForTests();
  __setSettingsPathForTests(null);
  searchFn = () => [cand(1)];
  suggFn = () => SUG;
});

const req = (method: string, body?: unknown, withCookie = true) =>
  new Request("http://localhost/api/x", {
    method,
    headers: { ...(withCookie ? { cookie } : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}) },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
// biome-ignore lint: test helper
const j = async (r: Response): Promise<any> => r.json();

async function newLot(body: unknown = { defaultRecord: "VG+", defaultSleeve: "VG" }) {
  const r = await createSession(req("POST", body));
  return { r, body: await j(r) };
}

test("every handler returns 401 without a session cookie", async () => {
  const calls: Promise<Response>[] = [
    listSessions(req("GET", undefined, false)),
    createSession(req("POST", {}, false)),
    getSession(req("GET", undefined, false), ctx("1")),
    resumeSession(req("POST", {}, false), ctx("1")),
    patchSession(req("PATCH", {}, false), ctx("1")),
    deleteSession(req("DELETE", undefined, false), ctx("1")),
    addItems(req("POST", {}, false), ctx("1")),
    reprice(req("POST", undefined, false), ctx("1")),
    patchItem(req("PATCH", {}, false), ctx("1")),
    deleteItem(req("DELETE", undefined, false), ctx("1")),
    retryItem(req("POST", undefined, false), ctx("1")),
    getCandidates(req("GET", undefined, false), ctx("1")),
  ];
  for (const r of await Promise.all(calls)) {
    assert.equal(r.status, 401);
    assert.equal((await j(r)).kind, "auth");
  }
});

test("create with default name, list, get", async () => {
  const { r, body } = await newLot();
  assert.equal(r.status, 201);
  assert.match(body.name, /^Lot [A-Z][a-z]{2} \d{1,2}$/);
  assert.equal(body.defaultRecord, "VG+");
  const list = await j(await listSessions(req("GET")));
  assert.equal(list.sessions.length, 1);
  assert.deepEqual(
    Object.keys(list.sessions[0]).sort(),
    ["defaultRecord", "defaultSleeve", "id", "itemCount", "name", "suggested", "updatedAt"],
  );
  const got = await j(await getSession(req("GET"), ctx(String(body.id))));
  assert.equal(got.session.id, body.id);
  assert.deepEqual(got.items, []);
  assert.equal(got.totals.total, 0);
  assert.deepEqual(got.queue, { pending: 0, paused: false, etaSeconds: 0 });
});

test("rename; validation errors are 400", async () => {
  const { body } = await newLot({ name: "  Crate A ", defaultRecord: "NM", defaultSleeve: "NM" });
  assert.equal(body.name, "Crate A");
  const id = String(body.id);
  const ok = await patchSession(req("PATCH", { name: "Crate B", defaultRecord: "G" }), ctx(id));
  assert.equal(ok.status, 200);
  assert.equal((await j(ok)).defaultRecord, "G");
  const long = await patchSession(req("PATCH", { name: "x".repeat(81) }), ctx(id));
  assert.equal(long.status, 400);
  assert.equal((await j(long)).kind, "bad-request");
  assert.equal((await patchSession(req("PATCH", { defaultRecord: "Z" }), ctx(id))).status, 400);
  assert.equal((await createSession(req("POST", { defaultRecord: "NM", defaultSleeve: "bad" }))).status, 400);
  assert.equal((await createSession(req("POST", { name: "", defaultRecord: "NM", defaultSleeve: "NM" }))).status, 400);
  assert.equal((await patchSession(req("PATCH", "{nope"), ctx(id))).status, 400);
  assert.equal((await patchSession(req("PATCH", { name: "A" }), ctx("999"))).status, 404);
});

test("add 3 lines, worker runs, get shows statuses and totals", async () => {
  searchFn = (q) => (q === "B" ? [cand(2), cand(3)] : q === "C" ? [] : [cand(1)]);
  const { body } = await newLot();
  const r = await addItems(req("POST", { lines: [{ query: "A", year: 1971 }, { query: " B " }, { query: "C", year: null }], record: "NM", sleeve: "VG+" }), ctx(String(body.id)));
  assert.equal(r.status, 201);
  const added = (await j(r)).added;
  assert.equal(added.length, 3);
  assert.equal(added[1].query, "B");
  await kickWorker();
  const got = await j(await getSession(req("GET"), ctx(String(body.id))));
  const byQuery = Object.fromEntries(got.items.map((i: { query: string; status: string }) => [i.query, i.status]));
  assert.deepEqual(byQuery, { A: "priced", B: "to-pick", C: "no-match" });
  assert.equal(got.totals.priced, 1);
  assert.equal(got.totals.toPick, 1);
  assert.equal(got.totals.problems, 1);
  assert.ok(got.totals.suggested > 0);
  assert.equal(got.queue.pending, 0);
  const list = await j(await listSessions(req("GET")));
  assert.equal(list.sessions[0].itemCount, 3);
  assert.equal(list.sessions[0].suggested, got.totals.suggested);
});

test("add validation: 501 lines, bad lines, bad grades, unknown lot, oversized body", async () => {
  const { body } = await newLot();
  const id = String(body.id);
  const lines = (n: number) => Array.from({ length: n }, (_, i) => ({ query: `Q${i}` }));
  assert.equal((await addItems(req("POST", { lines: lines(501), record: "NM", sleeve: "NM" }), ctx(id))).status, 400);
  assert.equal((await addItems(req("POST", { lines: [], record: "NM", sleeve: "NM" }), ctx(id))).status, 400);
  assert.equal((await addItems(req("POST", { lines: [{ query: "x".repeat(65) }], record: "NM", sleeve: "NM" }), ctx(id))).status, 400);
  assert.equal((await addItems(req("POST", { lines: [{ query: "A", year: 1800 }], record: "NM", sleeve: "NM" }), ctx(id))).status, 400);
  assert.equal((await addItems(req("POST", { lines: lines(1), record: "NM", sleeve: "?" }), ctx(id))).status, 400);
  assert.equal((await addItems(req("POST", { lines: lines(1), record: "NM", sleeve: "NM" }), ctx("999"))).status, 404);
  const big = JSON.stringify({ lines: lines(1), record: "NM", sleeve: "NM", pad: "x".repeat(130 * 1024) });
  assert.equal((await addItems(req("POST", big), ctx(id))).status, 400);
  // 500 lines is allowed
  const ok = await addItems(req("POST", { lines: lines(500), record: "NM", sleeve: "NM" }), ctx(id));
  assert.equal(ok.status, 201);
  searchFn = () => [];
  await kickWorker();
});

test("PATCH with a 64 KB+ body is 400, by header or by actual size", async () => {
  const { body } = await newLot();
  const id = String(body.id);
  const added = (await j(await addItems(req("POST", { lines: [{ query: "A" }], record: "NM", sleeve: "NM" }), ctx(id)))).added;
  await kickWorker();
  const pad = JSON.stringify({ record: "VG", pad: "x".repeat(65 * 1024) });
  assert.equal((await patchItem(req("PATCH", pad), ctx(String(added[0].id)))).status, 400);
  const withHeader = new Request("http://localhost/api/x", { method: "PATCH", headers: { cookie, "content-length": "70000" }, body: "{}" });
  assert.equal((await patchItem(withHeader, ctx(String(added[0].id)))).status, 400);
});

test("patch grades re-values without re-queuing; year change re-queues", async () => {
  const { body } = await newLot();
  const id = String(body.id);
  const [a] = (await j(await addItems(req("POST", { lines: [{ query: "A" }], record: "NM", sleeve: "NM" }), ctx(id)))).added;
  await kickWorker();
  const before = (await j(await getSession(req("GET"), ctx(id)))).items[0];
  const r = await patchItem(req("PATCH", { record: "VG" }), ctx(String(a.id)));
  const v = await j(r);
  assert.equal(v.status, "priced");
  assert.ok(v.market.suggested < before.market.suggested);
  assert.equal((await patchItem(req("PATCH", { record: "nope" }), ctx(String(a.id)))).status, 400);
  assert.equal((await patchItem(req("PATCH", { year: 1500 }), ctx(String(a.id)))).status, 400);
  const y = await j(await patchItem(req("PATCH", { year: 1975 }), ctx(String(a.id))));
  assert.equal(y.year, 1975);
  assert.equal(y.status, "pending");
  await kickWorker();
  assert.equal((await j(await getSession(req("GET"), ctx(id)))).items[0].status, "priced");
});

test("pick a valid release prices after the worker; invalid is 400; unknown is 404", async () => {
  searchFn = () => [cand(2), cand(3)];
  const { body } = await newLot();
  const id = String(body.id);
  const [a] = (await j(await addItems(req("POST", { lines: [{ query: "B" }], record: "NM", sleeve: "NM" }), ctx(id)))).added;
  await kickWorker();
  const itemId = String(a.id);
  const bad = await patchItem(req("PATCH", { releaseId: 999 }), ctx(itemId));
  assert.equal(bad.status, 400);
  assert.equal((await patchItem(req("PATCH", { releaseId: "3" }), ctx(itemId))).status, 400);
  assert.equal((await patchItem(req("PATCH", { releaseId: 3 }), ctx("12345"))).status, 404);
  const cands = await getCandidates(req("GET"), ctx(itemId));
  assert.equal(cands.status, 200);
  assert.deepEqual((await j(cands)).candidates.map((c: Candidate) => c.id), [2, 3]);
  const picked = await patchItem(req("PATCH", { releaseId: 3 }), ctx(itemId));
  assert.equal(picked.status, 200);
  assert.equal((await j(picked)).status, "pending");
  await kickWorker();
  const done = (await j(await getSession(req("GET"), ctx(id)))).items[0];
  assert.equal(done.status, "priced");
  assert.equal(done.release.id, 3);
  assert.equal((await getCandidates(req("GET"), ctx(itemId))).status, 404);
  // picking again on a resolved row is invalid
  assert.equal((await patchItem(req("PATCH", { releaseId: 3 }), ctx(itemId))).status, 400);
});

test("retry from error gives pending; wrong state is 400; reprice returns queued", async () => {
  searchFn = () => { throw new Error("boom"); };
  const { body } = await newLot();
  const id = String(body.id);
  const [a] = (await j(await addItems(req("POST", { lines: [{ query: "E" }], record: "NM", sleeve: "NM" }), ctx(id)))).added;
  await kickWorker();
  assert.equal((await j(await getSession(req("GET"), ctx(id)))).items[0].status, "error");
  searchFn = () => [cand(1)];
  const r = await retryItem(req("POST"), ctx(String(a.id)));
  assert.equal(r.status, 200);
  assert.equal((await j(r)).status, "pending");
  await kickWorker();
  assert.equal((await j(await getSession(req("GET"), ctx(id)))).items[0].status, "priced");
  assert.equal((await retryItem(req("POST"), ctx(String(a.id)))).status, 400);
  assert.equal((await retryItem(req("POST"), ctx("999"))).status, 404);
  const rp = await reprice(req("POST"), ctx(id));
  assert.deepEqual(await j(rp), { queued: 1 });
  await kickWorker();
  assert.equal((await reprice(req("POST"), ctx("999"))).status, 404);
});

test("delete item, delete lot, then get is 404", async () => {
  const { body } = await newLot();
  const id = String(body.id);
  const [a] = (await j(await addItems(req("POST", { lines: [{ query: "A" }], record: "NM", sleeve: "NM" }), ctx(id)))).added;
  await kickWorker();
  assert.deepEqual(await j(await deleteItem(req("DELETE"), ctx(String(a.id)))), { ok: true });
  assert.equal((await deleteItem(req("DELETE"), ctx(String(a.id)))).status, 404);
  assert.deepEqual(await j(await deleteSession(req("DELETE"), ctx(id))), { ok: true });
  assert.equal((await getSession(req("GET"), ctx(id))).status, 404);
  assert.equal((await deleteSession(req("DELETE"), ctx(id))).status, 404);
});

test("bad ids are 400", async () => {
  for (const bad of ["abc", "0", "-1", "1.5", "1e3"]) {
    assert.equal((await getSession(req("GET"), ctx(bad))).status, 400);
    assert.equal((await deleteSession(req("DELETE"), ctx(bad))).status, 400);
    assert.equal((await patchItem(req("PATCH", {}), ctx(bad))).status, 400);
    assert.equal((await retryItem(req("POST"), ctx(bad))).status, 400);
    assert.equal((await getCandidates(req("GET"), ctx(bad))).status, 400);
    assert.equal((await reprice(req("POST"), ctx(bad))).status, 400);
    assert.equal((await addItems(req("POST", {}), ctx(bad))).status, 400);
  }
});

test("invalid settings.json gives a 500 settings error, not a throw", async () => {
  const { body } = await newLot();
  __setSettingsPathForTests("/nonexistent/settings.json");
  const r = await getSession(req("GET"), ctx(String(body.id)));
  assert.equal(r.status, 500);
  const b = await j(r);
  assert.equal(b.status, "error");
  assert.equal(b.kind, "settings");
  assert.equal((await listSessions(req("GET"))).status, 500);
});

test("POST items kicks the worker itself, without a prior kickWorker", async () => {
  const { body: lot } = await newLot();
  const r = await addItems(req("POST", { lines: [{ query: "A" }, { query: "B" }], record: "NM", sleeve: "NM" }), ctx(String(lot.id)));
  assert.equal(r.status, 201);
  const deadline = Date.now() + 2000;
  let items: { status: string }[] = [];
  while (Date.now() < deadline) {
    items = (await j(await getSession(req("GET"), ctx(String(lot.id))))).items;
    if (items.every((i) => i.status === "priced")) break;
    await new Promise((res) => setTimeout(res, 10));
  }
  assert.deepEqual(items.map((i) => i.status), ["priced", "priced"]);
});

test("resume clears a paused queue", async () => {
  const { body: lot } = await newLot();
  searchFn = () => { throw new DiscogsError("nope", 401); };
  await addItems(req("POST", { lines: [{ query: "A" }, { query: "B" }], record: "NM", sleeve: "NM" }), ctx(String(lot.id)));
  await kickWorker();
  const deadline = Date.now() + 2000;
  while (!isQueuePaused() && Date.now() < deadline) await new Promise((res) => setTimeout(res, 10));
  assert.equal(isQueuePaused(), true);
  const paused = await j(await getSession(req("GET"), ctx(String(lot.id))));
  assert.equal(paused.queue.paused, true);

  searchFn = () => [cand(1)];
  const r = await resumeSession(req("POST", {}), ctx(String(lot.id)));
  assert.equal(r.status, 200);
  assert.equal((await j(r)).queue.paused, false);
  assert.equal(isQueuePaused(), false);
  assert.equal((await resumeSession(req("POST", {}), ctx("999"))).status, 404);
  await kickWorker();
});

test("session responses include the settings currency", async () => {
  const { body: lot } = await newLot();
  assert.equal(typeof (await j(await listSessions(req("GET")))).currency, "string");
  assert.equal(typeof (await j(await getSession(req("GET"), ctx(String(lot.id))))).currency, "string");
});

async function pricedLot() {
  searchFn = (q) => (q === "Z" ? [] : [cand(1)]);
  const { body } = await newLot();
  const id = String(body.id);
  await addItems(req("POST", { lines: [{ query: "A" }, { query: "Z" }], record: "NM", sleeve: "NM" }), ctx(id));
  await kickWorker();
  const got = await j(await getSession(req("GET"), ctx(id)));
  // biome-ignore lint: test helper
  const byQuery = (q: string) => got.items.find((i: any) => i.query === q);
  return { id, got, a: byQuery("A"), z: byQuery("Z") };
}

test("GET returns offer and isPick", async () => {
  const { got, a, z } = await pricedLot();
  assert.equal(got.offer.picks, 1);
  assert.equal(got.offer.bulkCount, 1);
  assert.equal(a.isPick, true);
  assert.equal(z.isPick, false);
  assert.equal(got.offer.pickOnly.rungs.length, 4);
});

test("PATCH session offer inputs", async () => {
  const { id } = await pricedLot();
  const r = await patchSession(req("PATCH", { unverified: true, pickThreshold: 25, bulkEach: 1, lotOverhead: 10 }), ctx(id));
  assert.equal(r.status, 200);
  const s = await j(r);
  assert.deepEqual([s.unverified, s.pickThreshold, s.bulkEach, s.lotOverhead], [true, 25, 1, 10]);
  assert.equal((await j(await getSession(req("GET"), ctx(id)))).offer.inputs.pickThreshold, 25);
  await patchSession(req("PATCH", { pickThreshold: null }), ctx(id));
  assert.equal((await j(await getSession(req("GET"), ctx(id)))).offer.inputs.pickThreshold, 15);
});

test("PATCH session rejects bad offer inputs", async () => {
  const { id } = await pricedLot();
  const bad: [unknown, RegExp][] = [
    [{ pickThreshold: "abc" }, /Pick threshold/],
    [{ pickThreshold: -1 }, /Pick threshold/],
    [{ pickThreshold: 100001 }, /Pick threshold/],
    [{ bulkEach: 1001 }, /Bulk per record/],
    [{ bulkEach: "1" }, /Bulk per record/],
    [{ lotOverhead: null }, /Lot overhead/],
    ['{"lotOverhead": 1e999}', /Lot overhead/],
    [{ unverified: "yes" }, /Condition unverified/],
  ];
  for (const [body, msg] of bad) {
    const r = await patchSession(req("PATCH", body), ctx(id));
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.match((await j(r)).message, msg);
  }
  const inputs = (await j(await getSession(req("GET"), ctx(id)))).offer.inputs;
  assert.deepEqual([inputs.unverified, inputs.pickThreshold, inputs.bulkEach, inputs.lotOverhead], [false, 15, 0.5, 0]);
});

test("PATCH item pick", async () => {
  const { id, a, z } = await pricedLot();
  const r = await patchItem(req("PATCH", { pick: false }), ctx(String(a.id)));
  assert.equal(r.status, 200);
  assert.equal((await j(r)).isPick, false);
  assert.equal((await j(await getSession(req("GET"), ctx(id)))).offer.picks, 0);
  assert.equal((await patchItem(req("PATCH", { pick: "no" }), ctx(String(a.id)))).status, 400);
  const nz = await patchItem(req("PATCH", { pick: true }), ctx(String(z.id)));
  assert.equal(nz.status, 400);
  assert.equal((await j(nz)).message, "This record has no market value to cherry-pick.");
});

test("a saved setting changes lot prices on the next read", async () => {
  const { body: lot } = await newLot();
  await addItems(req("POST", { lines: [{ query: "A" }], record: "VG+", sleeve: "VG" }), ctx(String(lot.id)));
  const deadline = Date.now() + 2000;
  let before = await j(await getSession(req("GET"), ctx(String(lot.id))));
  while (before.totals.priced < 1 && Date.now() < deadline) {
    await new Promise((res) => setTimeout(res, 10));
    before = await j(await getSession(req("GET"), ctx(String(lot.id))));
  }
  assert.equal(before.totals.priced, 1);
  saveSettings(g.__mintDb as DatabaseSync, { sleeveMultipliers: { VG: 0.5 } });
  const after = await j(await getSession(req("GET"), ctx(String(lot.id))));
  assert.ok(after.totals.suggested < before.totals.suggested, `${after.totals.suggested} < ${before.totals.suggested}`);
});

test("lot GET includes oldestPricedAt", async () => {
  const { body: lot } = await newLot();
  const empty = await j(await getSession(req("GET"), ctx(String(lot.id))));
  assert.equal(empty.oldestPricedAt, null);
  await addItems(req("POST", { lines: [{ query: "A" }], record: "VG+", sleeve: "VG" }), ctx(String(lot.id)));
  const deadline = Date.now() + 2000;
  let body = await j(await getSession(req("GET"), ctx(String(lot.id))));
  while (body.totals.priced < 1 && Date.now() < deadline) {
    await new Promise((res) => setTimeout(res, 10));
    body = await j(await getSession(req("GET"), ctx(String(lot.id))));
  }
  assert.equal(typeof body.oldestPricedAt, "number");
});

async function namedPricedLot(name: string) {
  const { body: lot } = await newLot({ name, defaultRecord: "VG+", defaultSleeve: "VG" });
  await addItems(req("POST", { lines: [{ query: "A" }], record: "VG+", sleeve: "VG" }), ctx(String(lot.id)));
  const deadline = Date.now() + 2000;
  let body = await j(await getSession(req("GET"), ctx(String(lot.id))));
  while (body.totals.priced < 1 && Date.now() < deadline) {
    await new Promise((res) => setTimeout(res, 10));
    body = await j(await getSession(req("GET"), ctx(String(lot.id))));
  }
  return { lot, body };
}

test("CSV export: auth, bad id, unknown lot", async () => {
  assert.equal((await exportCsv(req("GET", undefined, false), ctx("1"))).status, 401);
  assert.equal((await exportCsv(req("GET"), ctx("abc"))).status, 400);
  assert.equal((await exportCsv(req("GET"), ctx("999"))).status, 404);
});

test("CSV export downloads the lot as a Discogs file", async () => {
  const { lot } = await namedPricedLot("Café Sale");
  const r = await exportCsv(req("GET"), ctx(String(lot.id)));
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("content-type"), "text/csv; charset=utf-8");
  assert.equal(r.headers.get("content-disposition"), 'attachment; filename="caf-sale-discogs.csv"');
  assert.equal(r.headers.get("cache-control"), "no-store");
  const text = await r.text();
  assert.ok(text.startsWith("release_id,price,"));
  assert.equal(text.trimEnd().split("\r\n").length, 2);
});

test("lot GET includes exportCounts", async () => {
  const { body: lot } = await newLot();
  const empty = await j(await getSession(req("GET"), ctx(String(lot.id))));
  assert.deepEqual(empty.exportCounts, { exportable: 0, lookingUp: 0, skipped: 0 });
  const { body } = await namedPricedLot("L");
  assert.deepEqual(body.exportCounts, { exportable: 1, lookingUp: 0, skipped: 0 });
});

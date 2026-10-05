import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../lib/db.ts";
import { addItems, createSession, deleteItem, getItem, resetWorking, updateItemFields } from "../lib/collection/store.ts";
import { __resetWorkerForTests, isQueuePaused, kickWorker, processItem, resumeQueue } from "../lib/collection/worker.ts";
import { DiscogsError } from "../lib/discogs.ts";
import type { LookupClient } from "../lib/lookup.ts";
import type { Candidate, MarketplaceStats, PriceSuggestions } from "../lib/types.ts";

const cand = (id: number): Candidate => ({ id, title: `T${id}`, year: 1970, country: "US", label: "L", catno: "C", format: "LP", thumb: null });
const STATS: MarketplaceStats = { lowestPrice: 9, currency: "USD", numForSale: 4 };
const SUG: PriceSuggestions = { NM: 30, "VG+": 20, VG: 10 };

type Script = {
  search?: (q: string, y?: number) => Promise<Candidate[]> | Candidate[];
  suggestions?: (id: number) => Promise<PriceSuggestions | null> | PriceSuggestions | null;
};
function fake(script: Script = {}) {
  const calls: string[] = [];
  const client: LookupClient = {
    async searchByCatno(q, y) { calls.push(`search:${q}`); return script.search ? script.search(q, y) : [cand(1)]; },
    async priceSuggestions(id) { calls.push(`sugg:${id}`); return script.suggestions ? script.suggestions(id) : SUG; },
    async marketplaceStats(id) { calls.push(`stats:${id}`); return STATS; },
  };
  return { client, calls };
}
const setup = (queries: string[] = ["A"]) => {
  const db = openDb(":memory:");
  const s = createSession(db, { name: "L", defaultRecord: "NM", defaultSleeve: "NM" }, 100);
  const items = addItems(db, s.id, queries.map((query) => ({ query })), { record: "VG+", sleeve: "VG" }, 100);
  return { db, s, items };
};

beforeEach(() => __resetWorkerForTests());

test("no match", async () => {
  const { db, items } = setup();
  await kickWorker({ db, client: fake({ search: () => [] }).client, now: () => 500 });
  const r = getItem(db, items[0].id)!;
  assert.equal(r.status, "no-match");
  assert.equal(r.candidates, null);
});

test("several matches go to to-pick", async () => {
  const { db, items } = setup();
  await kickWorker({ db, client: fake({ search: () => [cand(1), cand(2)] }).client });
  const r = getItem(db, items[0].id)!;
  assert.equal(r.status, "to-pick");
  assert.deepEqual(r.candidates?.map((c) => c.id), [1, 2]);
});

test("one match is priced in the same call, in order search, suggestions, stats", async () => {
  const { db, items } = setup();
  const f = fake({ search: () => [cand(7)] });
  await kickWorker({ db, client: f.client, now: () => 777 });
  assert.deepEqual(f.calls, ["search:A", "sugg:7", "stats:7"]);
  const r = getItem(db, items[0].id)!;
  assert.equal(r.status, "priced");
  assert.equal(r.releaseId, 7);
  assert.equal(r.release?.id, 7);
  assert.equal(r.candidates, null);
  assert.deepEqual(r.suggestions, SUG);
  assert.deepEqual(r.stats, STATS);
  assert.equal(r.pricedAt, 777);
});

test("null suggestions and missing grade give no-price", async () => {
  const { db, items } = setup(["A", "B"]);
  let n = 0;
  await kickWorker({
    db,
    client: fake({ suggestions: () => (n++ === 0 ? null : { NM: 5 }) }).client,
    now: () => 9,
  });
  const first = getItem(db, items[0].id)!;
  const second = getItem(db, items[1].id)!;
  assert.equal(first.status, "no-price");
  assert.equal(first.suggestions, null);
  assert.deepEqual(first.stats, STATS);
  assert.equal(first.pricedAt, 9);
  assert.equal(second.status, "no-price");
  assert.deepEqual(second.suggestions, { NM: 5 });
});

test("non-401 error records a message and the loop continues", async () => {
  const { db, items } = setup(["A", "B"]);
  let n = 0;
  await kickWorker({
    db,
    client: fake({ search: () => { if (n++ === 0) throw new DiscogsError("x".repeat(300), 502); return [cand(2)]; } }).client,
  });
  const a = getItem(db, items[0].id)!;
  assert.equal(a.status, "error");
  assert.equal(a.error?.length, 200);
  assert.equal(getItem(db, items[1].id)!.status, "priced");
  assert.equal(isQueuePaused(), false);
});

test("error keeps an earlier release and suggestions", async () => {
  const { db, items } = setup();
  const f = fake({ search: () => [cand(3)] });
  await kickWorker({ db, client: f.client });
  db.prepare("UPDATE items SET status = 'pending' WHERE id = ?").run(items[0].id);
  // release id is now set, so make pricing fail
  const g = fake({ suggestions: () => { throw new Error("boom"); } });
  db.prepare("UPDATE items SET status = 'pending' WHERE id = ?").run(items[0].id);
  await kickWorker({ db, client: g.client });
  const r = getItem(db, items[0].id)!;
  assert.equal(r.status, "error");
  assert.equal(r.error, "boom");
  assert.equal(r.releaseId, 3);
  assert.deepEqual(r.suggestions, SUG);
});

test("401 pauses the queue until resumed", async () => {
  const { db, items } = setup(["A", "B"]);
  let reject = true;
  const f = fake({ search: () => { if (reject) throw new DiscogsError("nope", 401); return [cand(2)]; } });
  await kickWorker({ db, client: f.client });
  assert.equal(isQueuePaused(), true);
  const a = getItem(db, items[0].id)!;
  assert.equal(a.status, "error");
  assert.equal(a.error, "Discogs rejected the token");
  assert.equal(getItem(db, items[1].id)!.status, "pending");

  await kickWorker({ db, client: f.client });
  assert.equal(f.calls.length, 1);
  assert.equal(getItem(db, items[1].id)!.status, "pending");

  reject = false;
  resumeQueue();
  assert.equal(isQueuePaused(), false);
  await kickWorker({ db, client: f.client });
  assert.equal(getItem(db, items[1].id)!.status, "priced");
});

test("concurrent kicks process each row exactly once, oldest first", async () => {
  const { db } = setup(["A", "B", "C"]);
  const f = fake({ search: async () => { await new Promise((r) => setTimeout(r, 5)); return []; } });
  const first = kickWorker({ db, client: f.client });
  assert.equal(kickWorker({ db, client: f.client }), first);
  await first;
  assert.deepEqual(f.calls, ["search:A", "search:B", "search:C"]);
});

test("keep-alive pings run while the loop works and stop after it ends", async () => {
  const { db } = setup(["A", "B"]);
  let pings = 0;
  const f = fake({ search: async () => { await new Promise((r) => setTimeout(r, 40)); return []; } });
  await kickWorker({ db, client: f.client, keepAlive: () => { pings++; }, keepAliveMs: 10 });
  assert.ok(pings >= 2, `expected pings while pending, got ${pings}`);
  const after = pings;
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(pings, after);
});

test("an unexpected loop error releases the claimed row and does not spin", async () => {
  const { db, items } = setup(["A"]);
  const f = fake();
  let nowCalls = 0;
  await kickWorker({ db, client: f.client, now: () => { nowCalls++; throw new Error("clock broke"); } });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(getItem(db, items[0].id)!.status, "pending");
  assert.equal(nowCalls, 1);
  assert.equal(f.calls.length, 0);
});

test("item deleted during lookup stays deleted", async () => {
  const { db, items } = setup(["A", "B"]);
  const f = fake({
    search: (q) => { if (q === "A") deleteItem(db, items[0].id); return [cand(1)]; },
  });
  await kickWorker({ db, client: f.client });
  assert.equal(getItem(db, items[0].id), null);
  assert.equal(getItem(db, items[1].id)!.status, "priced");
});

test("grade changed during lookup survives the write", async () => {
  const { db, items } = setup();
  const f = fake({ search: () => { updateItemFields(db, items[0].id, { record: "G" }); return [cand(1)]; } });
  await kickWorker({ db, client: f.client });
  const r = getItem(db, items[0].id)!;
  assert.equal(r.record, "G");
  assert.equal(r.status, "priced");
});

test("resetWorking plus a kick processes a stranded working row", async () => {
  const { db, items } = setup();
  db.prepare("UPDATE items SET status = 'working' WHERE id = ?").run(items[0].id);
  resetWorking(db);
  await kickWorker({ db, client: fake().client });
  assert.equal(getItem(db, items[0].id)!.status, "priced");
});

test("kickWorker without an injected client is a no-op when Discogs env is missing", async () => {
  const saved = { t: process.env.DISCOGS_TOKEN, u: process.env.DISCOGS_USER_AGENT };
  delete process.env.DISCOGS_TOKEN;
  delete process.env.DISCOGS_USER_AGENT;
  try {
    await kickWorker();
  } finally {
    if (saved.t !== undefined) process.env.DISCOGS_TOKEN = saved.t;
    if (saved.u !== undefined) process.env.DISCOGS_USER_AGENT = saved.u;
  }
});

test("processItem with a release id skips the search", async () => {
  const { items } = setup();
  const f = fake();
  const patch = await processItem(f.client, { ...items[0], releaseId: 5 }, 1);
  assert.deepEqual(f.calls, ["sugg:5", "stats:5"]);
  assert.equal(patch.status, "priced");
  assert.equal("release" in patch, false);
});

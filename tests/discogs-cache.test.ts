import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { openDb } from "../lib/db.ts";
import { DiscogsError } from "../lib/discogs.ts";
import { CachedClient, searchKey } from "../lib/discogs-cache.ts";
import type { LookupClient } from "../lib/lookup.ts";
import type { Candidate, MarketplaceStats, PriceSuggestions } from "../lib/types.ts";

const SUG: PriceSuggestions = { NM: 30, "VG+": 20 };
const STATS: MarketplaceStats = { lowestPrice: 9, currency: "USD", numForSale: 4 };
const cand = (id: number): Candidate => ({ id, title: `T${id}`, year: 1971, country: "US", label: "L", catno: "C", format: "LP", thumb: null });

let db: DatabaseSync;
let t: number;
let hours: number;
let calls: string[];
let fail: Error | null;
let sugg: PriceSuggestions | null;
let found: Candidate[];
let c: CachedClient;

const inner: LookupClient = {
  async searchByCatno(q, y) {
    calls.push(`search:${q}:${y}`);
    if (fail) throw fail;
    return found;
  },
  async priceSuggestions(id) {
    calls.push(`sugg:${id}`);
    if (fail) throw fail;
    return sugg;
  },
  async releaseStats(id) {
    calls.push(`release:${id}`);
    if (fail) throw fail;
    return STATS;
  },
};
const count = (k: string) => calls.filter((x) => x === k).length;
const rows = () => (db.prepare("select count(*) as n from discogs_cache").get() as { n: number }).n;

beforeEach(() => {
  db = openDb(":memory:");
  t = 1_000_000_000;
  hours = 24;
  calls = [];
  fail = null;
  sugg = SUG;
  found = [cand(1)];
  c = new CachedClient(inner, { db: () => db, cacheHours: () => hours, now: () => t });
});

test("a miss fetches and stores; a hit makes no inner call", async () => {
  assert.deepEqual(await c.priceSuggestions(7), { value: SUG, fetchedAt: t });
  t += 1000;
  assert.deepEqual(await c.priceSuggestions(7), { value: SUG, fetchedAt: t - 1000 });
  assert.equal(count("sugg:7"), 1);
});

test("an entry exactly cacheHours old is expired", async () => {
  await c.releaseStats(7);
  t += 24 * 3_600_000 - 1;
  await c.releaseStats(7);
  assert.equal(count("release:7"), 1);
  t += 1;
  await c.releaseStats(7);
  assert.equal(count("release:7"), 2);
});

test("fresh bypasses the cache and overwrites the entry", async () => {
  await c.priceSuggestions(7);
  t += 1000;
  assert.deepEqual(await c.priceSuggestions(7, { fresh: true }), { value: SUG, fetchedAt: t });
  assert.equal(count("sugg:7"), 2);
  t += 1000;
  assert.equal((await c.priceSuggestions(7)).fetchedAt, t - 1000);
  assert.equal(count("sugg:7"), 2);
});

test("empty search and null suggestions are cached", async () => {
  found = [];
  sugg = null;
  assert.deepEqual((await c.searchByCatno("X 1", 1971)).value, []);
  assert.equal((await c.priceSuggestions(7)).value, null);
  assert.deepEqual((await c.searchByCatno("X 1", 1971)).value, []);
  assert.equal((await c.priceSuggestions(7)).value, null);
  assert.equal(calls.length, 2);
});

test("inner errors are not cached and an existing entry survives", async () => {
  await c.priceSuggestions(7);
  const t0 = t;
  fail = new DiscogsError("Discogs returned 503", 503);
  t += 1000;
  await assert.rejects(c.priceSuggestions(7, { fresh: true }), /503/);
  assert.equal((await c.priceSuggestions(7)).fetchedAt, t0);
  t += 24 * 3_600_000;
  await assert.rejects(c.priceSuggestions(7), /503/);
  fail = null;
  assert.equal((await c.priceSuggestions(7)).fetchedAt, t);
});

test("cacheHours 0 neither reads nor writes", async () => {
  hours = 0;
  await c.priceSuggestions(7);
  await c.priceSuggestions(7);
  assert.equal(count("sugg:7"), 2);
  assert.equal(rows(), 0);
});

test("a corrupt entry is refetched and overwritten", async () => {
  db.prepare("insert into discogs_cache (key, json, fetched_at) values ('suggestions:7', '{bad', ?)").run(t);
  assert.deepEqual((await c.priceSuggestions(7)).value, SUG);
  assert.equal(count("sugg:7"), 1);
  assert.deepEqual((await c.priceSuggestions(7)).value, SUG);
  assert.equal(count("sugg:7"), 1);
});

test("expired rows are deleted when something is written", async () => {
  await c.priceSuggestions(1);
  t += 25 * 3_600_000;
  await c.priceSuggestions(2);
  const keys = (db.prepare("select key from discogs_cache").all() as { key: string }[]).map((r) => r.key);
  assert.deepEqual(keys, ["suggestions:2"]);
});

test("a fetched_at in the future is not a hit", async () => {
  db.prepare("insert into discogs_cache (key, json, fetched_at) values ('suggestions:7', ?, ?)").run(JSON.stringify(SUG), t + 3_600_000);
  await c.priceSuggestions(7);
  assert.equal(count("sugg:7"), 1);
});

test("cacheHours throwing means no cache, not a failed lookup", async () => {
  const broken = new CachedClient(inner, { db: () => db, cacheHours: () => { throw new Error("bad settings"); }, now: () => t });
  const errors: unknown[] = [];
  const orig = console.error;
  console.error = (...a: unknown[]) => void errors.push(a);
  try {
    assert.deepEqual((await broken.priceSuggestions(7)).value, SUG);
  } finally {
    console.error = orig;
  }
  assert.equal(rows(), 0);
  assert.equal(errors.length, 1);
});

test("a failing database never fails the lookup", async () => {
  const broken = new CachedClient(inner, { db: () => { throw new Error("disk gone"); }, cacheHours: () => 24, now: () => t });
  const orig = console.error;
  console.error = () => {};
  try {
    assert.deepEqual((await broken.releaseStats(7)).value, STATS);
  } finally {
    console.error = orig;
  }
});

test("searchKey ignores case and spacing and includes the year", () => {
  assert.equal(searchKey("  SD  7208 ", 1971), searchKey("sd 7208", 1971));
  assert.notEqual(searchKey("sd 7208", 1971), searchKey("sd 7208", undefined));
  assert.equal(searchKey("SD 7208", undefined), "search:sd 7208|-");
});

test("search results are cached per query and year", async () => {
  await c.searchByCatno("SD 7208", 1971);
  await c.searchByCatno("sd 7208", 1971);
  assert.equal(calls.length, 1);
  await c.searchByCatno("SD 7208", 1972);
  assert.equal(calls.length, 2);
});

test("release details are cached under release:<id>", async () => {
  await c.releaseStats(7);
  const keys = (db.prepare("select key from discogs_cache").all() as { key: string }[]).map((r) => r.key);
  assert.deepEqual(keys, ["release:7"]);
});

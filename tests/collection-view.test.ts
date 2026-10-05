import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { computeTotals, marketFor, queueState, toItemView } from "../lib/collection/view.ts";
import { createScanFilter, defaultLotName, pollDelayMs } from "../lib/collection/ui.ts";
import { priceRecord } from "../lib/pricing.ts";
import { parseSettings } from "../lib/settings.ts";
import type { ItemRow } from "../lib/collection/types.ts";
import type { Candidate } from "../lib/types.ts";

const settings = parseSettings(JSON.parse(readFileSync("settings.json", "utf8")));
const cand = (id: number): Candidate => ({
  id, title: `R${id}`, year: 1971, country: "US", label: "L", catno: "C", format: "LP", thumb: null,
});
let nextId = 1;
const item = (o: Partial<ItemRow>): ItemRow => ({
  id: nextId++, sessionId: 1, query: "Q", year: null, record: "VG+", sleeve: "VG+", status: "pending",
  releaseId: null, release: null, candidates: null, suggestions: null, stats: null, pricedAt: null,
  error: null, createdAt: 0, pick: null, ...o,
});
const sugg = { NM: 40, "VG+": 30, VG: 20 };
const stats = { lowestPrice: 12, currency: "USD", numForSale: 3 };

test("marketFor matches priceRecord market", () => {
  const it = item({ status: "priced", suggestions: sugg, stats });
  const p = priceRecord({ suggestions: sugg, lowestListing: 12, record: "VG+", sleeve: "VG+", settings })!;
  assert.deepEqual(marketFor(it, settings), { low: p.market.low, suggested: p.market.suggested, high: p.market.high });
});

test("marketFor null without suggestions or grade", () => {
  assert.equal(marketFor(item({}), settings), null);
  assert.equal(marketFor(item({ suggestions: sugg, record: "F" }), settings), null);
});

test("toItemView maps working and counts candidates", () => {
  const v = toItemView(item({ status: "working", candidates: [cand(1), cand(2)] }), settings);
  assert.equal(v.status, "looking-up");
  assert.equal(v.candidateCount, 2);
  assert.equal(toItemView(item({ status: "error", error: "x" }), settings).candidateCount, 0);
});

test("computeTotals over a mix", () => {
  const priced = item({ status: "priced", suggestions: sugg, stats });
  const items = [
    priced,
    item({ status: "to-pick", candidates: [cand(1), cand(2)] }),
    item({ status: "no-match" }),
    item({ status: "error", error: "boom" }),
    item({ status: "no-price", suggestions: {} }),
    item({ status: "priced", suggestions: sugg, record: "F" }),
    item({ status: "pending", suggestions: sugg, stats }),
    item({ status: "pending" }),
    item({ status: "working" }),
  ];
  const m = marketFor(priced, settings)!;
  const t = computeTotals(items, settings);
  assert.equal(t.total, 9);
  assert.equal(t.priced, 2);
  assert.equal(t.toPick, 1);
  assert.equal(t.noPrice, 2);
  assert.equal(t.problems, 2);
  assert.equal(t.pending, 2);
  assert.equal(t.refreshing, 1);
  assert.equal(t.stale, 0);
  assert.equal(t.priced + t.toPick + t.noPrice + t.problems + t.pending, t.total);
  assert.equal(t.low, Math.round(m.low * 2 * 100) / 100);
  assert.equal(t.suggested, Math.round(m.suggested * 2 * 100) / 100);
  assert.equal(t.high, Math.round(m.high * 2 * 100) / 100);
});

test("a row with a value lands only in priced, whatever its status", () => {
  const items = [
    item({ status: "error", error: "x", suggestions: sugg, stats }),
    item({ status: "no-price", suggestions: sugg, stats }),
    item({ status: "working", suggestions: sugg, stats }),
  ];
  const t = computeTotals(items, settings);
  assert.equal(t.priced, 3);
  assert.equal(t.problems + t.noPrice + t.pending + t.toPick, 0);
  assert.equal(t.stale, 1);
  assert.equal(t.refreshing, 1);
  assert.equal(t.priced, t.total);
  assert.ok(t.suggested > 0);
});

test("list rows carry candidateCount without the candidate array", () => {
  const v = toItemView(item({ status: "to-pick", candidates: null, candidateCount: 7 }), settings);
  assert.equal(v.candidateCount, 7);
});

test("queueState eta", () => {
  assert.deepEqual(queueState(10, false), { pending: 10, paused: false, etaSeconds: 33 });
  assert.equal(pollDelayMs(5, true), 15000);
});

test("ui helpers", () => {
  assert.equal(defaultLotName(new Date(2026, 9, 4)), "Lot Oct 4");
  assert.equal(pollDelayMs(1), 2000);
  assert.equal(pollDelayMs(0), 15000);
});

test("scan filter", () => {
  const f = createScanFilter();
  assert.equal(f("A", 0), true);
  assert.equal(f("A", 2999), false);
  assert.equal(f("B", 3000), true);
  assert.equal(f("A", 3000), true);
  const g = createScanFilter();
  g("A", 0);
  assert.equal(g("A", 3000), true);
});

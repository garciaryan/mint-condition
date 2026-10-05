import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { computeOffer, isPickRow, offerInputs, offerMarket } from "../lib/offer.ts";
import { parseSettings } from "../lib/settings.ts";
import type { ItemRow } from "../lib/collection/types.ts";

const settings = parseSettings(JSON.parse(readFileSync("settings.json", "utf8")));
let nextId = 1;
const item = (o: Partial<ItemRow>): ItemRow => ({
  id: nextId++, sessionId: 1, query: "Q", year: null, record: "VG+", sleeve: "NM", status: "pending",
  releaseId: null, release: null, candidates: null, suggestions: null, stats: null, pricedAt: null,
  error: null, createdAt: 0, pick: null, ...o,
});
const stats = { lowestPrice: 12, currency: "USD", numForSale: 3 };
const A = item({ status: "priced", suggestions: { NM: 40, "VG+": 30, VG: 20 }, stats });
const B = item({ status: "priced", suggestions: { NM: 12, "VG+": 10, VG: 6 }, stats });
const C = item({ status: "pending" });
const base = offerInputs({ unverified: false, pickThreshold: null, bulkEach: null, lotOverhead: 0 }, settings);

test("offerInputs falls back to settings for null threshold and bulk", () => {
  assert.deepEqual(base, { unverified: false, pickThreshold: 15, bulkEach: 0.5, lotOverhead: 0 });
  assert.deepEqual(offerInputs({ unverified: true, pickThreshold: 5, bulkEach: 1, lotOverhead: 20 }, settings),
    { unverified: true, pickThreshold: 5, bulkEach: 1, lotOverhead: 20 });
});

test("ladder and walk-away for picks and whole lot", () => {
  const o = computeOffer([A, B, C], base, settings);
  assert.equal(o.picks, 1); assert.equal(o.bulkCount, 2); assert.equal(o.unpricedCount, 1);
  assert.equal(o.pickValue, 30); assert.equal(o.pickNet, 26.48);   // 30 * 0.97 * 0.91
  assert.equal(o.openingPercent, 40);
  assert.equal(o.pickOnly.walkAway, 17);                           // floor(26.481 * 0.7 - 1.5)
  assert.deepEqual(o.pickOnly.rungs.map((r) => [r.percent, r.amount, r.keep, r.overMax]),
    [[30, 9, 8, false], [40, 12, 5, false], [50, 15, 2, false], [60, 18, -1, true]]);
  assert.equal(o.wholeLot.walkAway, 18);                           // 17 + 0.5 * 2
  assert.deepEqual(o.wholeLot.rungs.map((r) => [r.amount, r.overMax]),
    [[10, false], [13, false], [16, false], [19, true]]);
  assert.deepEqual(o.inputs, { ...base, unverifiedSteps: 1, overheadPerRecord: 1.5, marginPercent: 30 });
});

test("threshold is inclusive; pins override it", () => {
  const at15 = item({ ...A, suggestions: { NM: 20, "VG+": 15, VG: 10 } });
  assert.equal(isPickRow(at15, base, settings), true);
  assert.equal(computeOffer([{ ...A, pick: false }, B], base, settings).picks, 0);
  assert.equal(computeOffer([A, { ...B, pick: true }], base, settings).picks, 2);
});

test("unpriced rows are bulk and never picks, even when pinned", () => {
  const pinned = { ...C, pick: true };
  assert.equal(isPickRow(pinned, base, settings), false);
  assert.equal(computeOffer([pinned], base, settings).bulkCount, 1);
});

test("unverified lowers both grades; a missing grade becomes unpriced", () => {
  const u = { ...base, unverified: true };
  assert.equal(offerMarket(A, u, settings)!.suggested, 19);       // VG 20 * sleeve VG+ 0.95
  const noG = item({ ...A, record: "VG", pick: true });            // VG -> G+, no G+ suggestion
  assert.equal(offerMarket(noG, u, settings), null);
  const o = computeOffer([noG], u, settings);
  assert.equal(o.picks, 0); assert.equal(o.unpricedCount, 1);   // pin survival in the DB is tested in store tests
});

test("lot overhead floors pick walk-away at 0", () => {
  const o = computeOffer([A, B, C], { ...base, lotOverhead: 20 }, settings);
  assert.equal(o.pickOnly.walkAway, 0); assert.equal(o.wholeLot.walkAway, 1);
});

test("nothing priced yet: zero picks, whole lot is bulk", () => {
  const o = computeOffer([C, { ...C, id: 99 }], base, settings);
  assert.equal(o.picks, 0); assert.equal(o.pickValue, 0);
  assert.ok(o.pickOnly.rungs.every((r) => r.amount === 0 && !r.overMax));
  assert.equal(o.wholeLot.walkAway, 1);
  assert.deepEqual(o.wholeLot.rungs.map((r) => r.amount), [1, 1, 1, 1]);
});

test("empty lot", () => {
  const o = computeOffer([], base, settings);
  assert.equal(o.picks + o.bulkCount, 0); assert.equal(o.wholeLot.walkAway, 0);
});

test("floor is applied after rounding to cents (29% of $100 is $29)", () => {
  const s = parseSettings({ ...settings, offer: { ...settings.offer, ladderPercents: [29], openingPercent: 29 } });
  const hundred = item({ ...A, suggestions: { NM: 120, "VG+": 100, VG: 80 } });
  assert.equal(computeOffer([hundred], base, s).pickOnly.rungs[0].amount, 29);
});

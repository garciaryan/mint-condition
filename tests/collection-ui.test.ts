import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { coverageText, displayStatus, etaText, offerNotes, offerSummary, pasteSummary } from "../lib/collection/ui.ts";
import { computeOffer, offerInputs } from "../lib/offer.ts";
import { parseSettings } from "../lib/settings.ts";
import type { ItemRow } from "../lib/collection/types.ts";

test("coverageText omits zero parts after priced", () => {
  assert.equal(
    coverageText({ priced: 62, total: 70, toPick: 4, noPrice: 2, problems: 1 }),
    "62 of 70 priced · 4 to pick · 2 no price · 1 error",
  );
  assert.equal(coverageText({ priced: 3, total: 3, toPick: 0, noPrice: 0, problems: 0 }), "3 of 3 priced");
  assert.equal(coverageText({ priced: 0, total: 2, toPick: 0, noPrice: 0, problems: 2 }), "0 of 2 priced · 2 error");
});

test("coverageText appends updating and couldn't refresh", () => {
  assert.equal(
    coverageText({ priced: 5, total: 7, toPick: 0, noPrice: 0, problems: 0, refreshing: 2, stale: 1 }),
    "5 of 7 priced · 2 updating · 1 couldn't refresh",
  );
  assert.equal(coverageText({ priced: 1, total: 1, toPick: 0, noPrice: 0, problems: 0, refreshing: 0, stale: 0 }), "1 of 1 priced");
});

test("displayStatus shows a no-price row with a value as priced", () => {
  assert.equal(displayStatus({ status: "no-price", market: { suggested: 1 } }), "priced");
  assert.equal(displayStatus({ status: "no-price", market: null }), "no-price");
  assert.equal(displayStatus({ status: "error", market: { suggested: 1 } }), "error");
});

test("etaText formats seconds and minutes", () => {
  assert.equal(etaText(5), "5 sec");
  assert.equal(etaText(59), "59 sec");
  assert.equal(etaText(120), "2 min");
  assert.equal(etaText(0), "1 sec");
});

test("pasteSummary lists skipped lines", () => {
  assert.equal(pasteSummary(23, []), "23 records");
  assert.equal(pasteSummary(1, [4]), "1 record, 1 line skipped: line 4");
  assert.equal(pasteSummary(5, [2, 3]), "5 records, 2 lines skipped: lines 2, 3");
  assert.equal(pasteSummary(5, [1, 2, 3, 4, 5, 6]), "5 records, 6 lines skipped: lines 1, 2, 3, 4, 5, …");
});

import { createSerialQueue } from "../lib/collection/ui.ts";

test("createSerialQueue runs jobs one at a time, in order, and survives rejection", async () => {
  const enqueue = createSerialQueue();
  const log: string[] = [];
  let running = 0;
  let maxRunning = 0;
  const job = (name: string, ms: number, fail = false) => async () => {
    running++;
    maxRunning = Math.max(maxRunning, running);
    log.push(`start ${name}`);
    await new Promise((r) => setTimeout(r, ms));
    running--;
    log.push(`end ${name}`);
    if (fail) throw new Error(name);
    return name;
  };
  const results = await Promise.allSettled([enqueue(job("a", 30)), enqueue(job("b", 1, true)), enqueue(job("c", 1))]);
  assert.equal(maxRunning, 1);
  assert.deepEqual(log, ["start a", "end a", "start b", "end b", "start c", "end c"]);
  assert.deepEqual(results.map((r) => r.status), ["fulfilled", "rejected", "fulfilled"]);
});

import { STATUS_INFO } from "../lib/collection/ui.ts";
test("STATUS_INFO covers every item status with text", () => {
  for (const k of ["pending", "looking-up", "to-pick", "priced", "no-match", "no-price", "error"] as const) {
    assert.ok(STATUS_INFO[k].text.length > 0);
  }
  assert.equal(STATUS_INFO.priced.text, "Priced");
});

const settings = parseSettings(JSON.parse(readFileSync("settings.json", "utf8")));
const row = (o: Partial<ItemRow>): ItemRow => ({
  id: 1, sessionId: 1, query: "Q", year: null, record: "VG+", sleeve: "NM", status: "pending", releaseId: null,
  release: null, candidates: null, suggestions: null, stats: null, pricedAt: null, error: null, createdAt: 0,
  pick: null, refresh: false, ...o,
});
const stats = { lowestPrice: 12, currency: "USD", numForSale: 3 };
const lot = [
  row({ status: "priced", suggestions: { NM: 40, "VG+": 30, VG: 20 }, stats }),
  row({ status: "priced", suggestions: { NM: 12, "VG+": 10, VG: 6 }, stats }),
  row({}),
];
const inputs = offerInputs({ unverified: false, pickThreshold: null, bulkEach: null, lotOverhead: 0 }, settings);

test("offerSummary shows the whole-lot opening rung and walk-away", () => {
  assert.equal(offerSummary(computeOffer(lot, inputs, settings), "USD"), "Offer · open $13 · max $18");
});

test("offerNotes lists only the notes that apply", () => {
  assert.deepEqual(offerNotes(computeOffer(lot, inputs, settings), "USD"), ["1 record unpriced, counted as bulk at $0.50 each"]);
  const o = computeOffer([row({}), row({})], { ...inputs, unverified: true }, settings);
  assert.deepEqual(offerNotes(o, "USD"), [
    "2 records unpriced, counted as bulk at $0.50 each",
    "Grades lowered 1 step for this offer (condition unverified)",
    "Picks: none at or above $15",
  ]);
});

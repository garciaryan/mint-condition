import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  downgrade,
  gradeAbove,
  gradeBelow,
  marketValue,
  priceRecord,
  sellPrice,
} from "../lib/pricing.ts";
import { parseSettings } from "../lib/settings.ts";
import type { PriceSuggestions } from "../lib/types.ts";

const settings = parseSettings(JSON.parse(readFileSync("settings.json", "utf8")));

const suggestions: PriceSuggestions = {
  M: 50,
  NM: 40,
  "VG+": 30,
  VG: 20,
  "G+": 10,
  G: 6,
  F: 3,
  P: 1,
};

test("grade navigation", () => {
  assert.equal(gradeBelow("NM"), "VG+");
  assert.equal(gradeBelow("P"), null);
  assert.equal(gradeAbove("VG+"), "NM");
  assert.equal(gradeAbove("M"), null);
  assert.equal(downgrade("NM", 1), "VG+");
  assert.equal(downgrade("G", 5), "P");
  assert.equal(downgrade("VG", 0), "VG");
});

test("market value uses the record grade price and the sleeve multiplier", () => {
  const m = marketValue(suggestions, "VG+", "VG", settings)!;
  assert.equal(m.basePrice, 30);
  assert.equal(m.sleeveMultiplier, 0.85);
  assert.equal(m.suggested, 25.5); // 30 * 0.85
  assert.equal(m.low, 17); // VG 20 * 0.85
  assert.equal(m.high, 34); // NM 40 * 0.85
});

test("a mint/near-mint sleeve does not change the price", () => {
  assert.equal(marketValue(suggestions, "VG+", "NM", settings)!.suggested, 30);
  assert.equal(marketValue(suggestions, "VG+", "M", settings)!.suggested, 30);
});

test("range clamps at the ends of the grade scale", () => {
  const top = marketValue(suggestions, "M", "NM", settings)!;
  assert.equal(top.high, top.suggested);
  const bottom = marketValue(suggestions, "P", "NM", settings)!;
  assert.equal(bottom.low, bottom.suggested);
});

test("range falls back to the suggested price when a neighbour grade has no data", () => {
  const sparse: PriceSuggestions = { "VG+": 30 };
  const m = marketValue(sparse, "VG+", "NM", settings)!;
  assert.equal(m.low, 30);
  assert.equal(m.high, 30);
});

test("returns null when the record grade has no suggestion", () => {
  assert.equal(marketValue({ NM: 40 }, "VG", "NM", settings), null);
});

test("sell price applies the undercut", () => {
  const m = marketValue(suggestions, "NM", "NM", settings)!;
  const s = sellPrice(m, null, settings);
  assert.equal(s.price, 38.8); // 40 * 0.97
  assert.equal(s.aboveLowestListing, false);
});

test("sell price respects the floor", () => {
  const m = marketValue({ P: 0.5 }, "P", "NM", settings)!;
  assert.equal(sellPrice(m, null, settings).price, settings.sell.floor);
});

test("sell price flags when it is above the cheapest listing", () => {
  const m = marketValue(suggestions, "NM", "NM", settings)!;
  assert.equal(sellPrice(m, 25, settings).aboveLowestListing, true);
  assert.equal(sellPrice(m, 60, settings).aboveLowestListing, false);
});

test("sell price carries what you'd net on Discogs after the seller fee", () => {
  const m = marketValue(suggestions, "NM", "NM", settings)!;
  assert.equal(sellPrice(m, null, settings).net, 35.31); // 38.80 * 0.91
});

test("priceRecord runs the whole pipeline and returns null without data", () => {
  const r = priceRecord({ suggestions, lowestListing: 22, record: "VG", sleeve: "VG+", settings })!;
  assert.equal(r.market.suggested, 19); // 20 * 0.95
  assert.equal(r.sell.price, 18.43); // 19 * 0.97
  assert.equal(r.sell.net, 16.77); // 18.43 * 0.91
  assert.equal("local" in r, false, "local sale was dropped");
  assert.equal(priceRecord({ suggestions: {}, lowestListing: null, record: "VG", sleeve: "VG", settings }), null);
});

test("settings validation rejects bad values", () => {
  assert.throws(() => parseSettings({ ...settings, sell: { undercutPercent: 120, floor: 1 } }));
  assert.throws(() =>
    parseSettings({ ...settings, sleeveMultipliers: { ...settings.sleeveMultipliers, VG: 0 } }),
  );
});

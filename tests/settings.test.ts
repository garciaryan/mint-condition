import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mergeSettings, parseSettings, settingsErrorPath } from "../lib/settings.ts";
import type { Settings } from "../lib/types.ts";

const settings = parseSettings(JSON.parse(readFileSync("settings.json", "utf8")));

test("settings.json has the offer defaults", () => {
  assert.deepEqual(settings.offer, {
    ladderPercents: [30, 40, 50, 60], openingPercent: 40, marginPercent: 30,
    overheadPerRecord: 1.5, pickThreshold: 15, bulkEach: 0.5, unverifiedSteps: 1,
  });
});

const withOffer = (o: Partial<Settings["offer"]>) => ({ ...settings, offer: { ...settings.offer, ...o } });

test("offer block is validated", () => {
  assert.throws(() => parseSettings({ ...settings, offer: undefined }), /offer/);
  assert.throws(() => parseSettings(withOffer({ ladderPercents: [] })), /ladderPercents/);
  assert.throws(() => parseSettings(withOffer({ ladderPercents: [10, 20, 30, 40, 50, 60, 70, 80, 90] })), /ladderPercents/);
  assert.throws(() => parseSettings(withOffer({ ladderPercents: [40, 30] })), /ladderPercents/);
  assert.throws(() => parseSettings(withOffer({ ladderPercents: [0, 40] })), /ladderPercents/);
  assert.throws(() => parseSettings(withOffer({ ladderPercents: [40, 101] })), /ladderPercents/);
  assert.throws(() => parseSettings(withOffer({ openingPercent: 45 })), /openingPercent/);
  assert.throws(() => parseSettings(withOffer({ marginPercent: 100 })), /marginPercent/);
  assert.throws(() => parseSettings(withOffer({ marginPercent: -1 })), /marginPercent/);
  assert.throws(() => parseSettings(withOffer({ overheadPerRecord: -1 })), /overheadPerRecord/);
  assert.throws(() => parseSettings(withOffer({ pickThreshold: -1 })), /pickThreshold/);
  assert.throws(() => parseSettings(withOffer({ bulkEach: -0.5 })), /bulkEach/);
  assert.throws(() => parseSettings(withOffer({ unverifiedSteps: 0 })), /unverifiedSteps/);
  assert.throws(() => parseSettings(withOffer({ unverifiedSteps: 4 })), /unverifiedSteps/);
  assert.throws(() => parseSettings(withOffer({ unverifiedSteps: 1.5 })), /unverifiedSteps/);
  assert.doesNotThrow(() => parseSettings(withOffer({ ladderPercents: [100], openingPercent: 100, marginPercent: 0 })));
});

const base = settings;

test("mergeSettings overrides nested values and keeps unsaved defaults", () => {
  const m = mergeSettings(base, { sell: { undercutPercent: 5 } }) as Settings;
  assert.equal(m.sell.undercutPercent, 5);
  assert.equal(m.sell.floor, base.sell.floor);
  assert.deepEqual(m.offer, base.offer);
});

test("mergeSettings replaces arrays whole and drops saved-only keys", () => {
  // biome-ignore lint: test helper
  const m = mergeSettings(base, { offer: { ladderPercents: [50] }, gone: 1, sell: { old: 2 } }) as Record<string, any>;
  assert.deepEqual(m.offer.ladderPercents, [50]);
  assert.equal("gone" in m, false);
  assert.equal("old" in m.sell, false);
});

test("mergeSettings treats a non-object saved value as nothing saved", () => {
  assert.deepEqual(mergeSettings(base, null), base);
  assert.deepEqual(mergeSettings(base, [1, 2]), base);
  assert.deepEqual(mergeSettings(base, "x"), base);
});

test("sell fields must be numbers and errors name the field", () => {
  const withSell = (v: object) => ({ ...base, sell: { ...base.sell, ...v } });
  assert.throws(() => parseSettings(withSell({ discogsFeePercent: null })), /sell\.discogsFeePercent/);
  assert.throws(() => parseSettings(withSell({ discogsFeePercent: 100 })), /sell\.discogsFeePercent/);
  assert.throws(() => parseSettings(withSell({ floor: "1" })), /sell\.floor/);
});

test("local sale is gone from the defaults", () => {
  assert.equal("local" in base, false);
  assert.equal(base.sell.discogsFeePercent, 9);
});

test("settingsErrorPath extracts the dotted path", () => {
  assert.equal(settingsErrorPath("settings: sleeveMultipliers.VG+ must be a number in (0, 1.5]"), "sleeveMultipliers.VG+");
  assert.equal(settingsErrorPath("settings: offer.openingPercent must be one of offer.ladderPercents"), "offer.openingPercent");
  assert.equal(settingsErrorPath("settings: expected an object"), null);
  assert.equal(settingsErrorPath("boom"), null);
});

test("discogs.cacheHours is a whole number from 0 to 6 (Discogs terms: data at most 6 hours old)", () => {
  const withHours = (h: unknown) => ({ ...base, discogs: { ...base.discogs, cacheHours: h } });
  for (const bad of [-1, 7, 24, 1.5, "6", null]) assert.throws(() => parseSettings(withHours(bad)), /discogs\.cacheHours/);
  for (const ok of [0, 6]) assert.doesNotThrow(() => parseSettings(withHours(ok)));
});

test("settings.json has the demand defaults", () => {
  assert.deepEqual(settings.demand, { fastWantHave: 1, fastMaxForSale: 10, slowWantHave: 0.3, slowForSale: 200 });
});

test("demand thresholds are validated", () => {
  const withDemand = (d: Partial<Settings["demand"]>) => parseSettings({ ...settings, demand: { ...settings.demand, ...d } });
  assert.throws(() => withDemand({ fastWantHave: -1 }), /demand\.fastWantHave/);
  assert.throws(() => withDemand({ slowForSale: 150.5 }), /demand\.slowForSale/);
  assert.throws(() => withDemand({ fastWantHave: 0.3 }), /demand\.fastWantHave must be greater than demand\.slowWantHave/);
  assert.throws(() => withDemand({ fastMaxForSale: 200 }), /demand\.fastMaxForSale must be less than demand\.slowForSale/);
  assert.throws(() => parseSettings({ ...settings, demand: undefined }), /demand must be an object/);
});

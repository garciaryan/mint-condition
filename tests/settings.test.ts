import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseSettings } from "../lib/settings.ts";
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

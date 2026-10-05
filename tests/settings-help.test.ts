import { test } from "node:test";
import assert from "node:assert/strict";
import { FIELD_KEYS } from "../lib/settings-form.ts";
import { settingHelp } from "../lib/settings-help.ts";

test("every settings field has help text", () => {
  for (const k of FIELD_KEYS) {
    const h = settingHelp(k);
    assert.ok(h.length >= 20, `${k} has no real help text`);
    assert.ok(h.length <= 200, `${k} help is too long for a bubble (${h.length})`);
  }
});

test("sleeve help names the grade in words", () => {
  assert.match(settingHelp("sleeveMultipliers.VG+"), /Very Good Plus/);
  assert.match(settingHelp("sleeveMultipliers.P"), /Poor/);
});

test("help matches what the setting does", () => {
  assert.match(settingHelp("sell.undercutPercent"), /Sell price = market value minus this %/);
  assert.match(settingHelp("offer.pickThreshold"), /any lot that doesn't set its own/);
  assert.match(settingHelp("discogs.cacheHours"), /At most 6/);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { FIELD_KEYS } from "../lib/settings-form.ts";
import { SLEEVE_HELP, settingHelp } from "../lib/settings-help.ts";

test("every settings field outside the sleeve grid has its own help text", () => {
  for (const k of FIELD_KEYS.filter((k) => !k.startsWith("sleeveMultipliers."))) {
    const h = settingHelp(k);
    assert.ok(h !== null && h.length >= 20, `${k} has no real help text`);
    assert.ok(h.length <= 200, `${k} help is too long for a bubble (${h.length})`);
  }
});

test("sleeve grades share one help note on the section heading", () => {
  assert.equal(settingHelp("sleeveMultipliers.VG+"), null);
  assert.ok(SLEEVE_HELP.length >= 20 && SLEEVE_HELP.length <= 200);
  assert.match(SLEEVE_HELP, /Discogs suggestion for the record grade/);
});

test("help matches what the setting does", () => {
  assert.match(settingHelp("sell.undercutPercent") ?? "", /Sell price = market value minus this %/);
  assert.match(settingHelp("offer.pickThreshold") ?? "", /any lot that doesn't set its own/);
  assert.match(settingHelp("discogs.cacheHours") ?? "", /At most 6/);
});

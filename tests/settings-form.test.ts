import { test } from "node:test";
import assert from "node:assert/strict";
import { loadSettings, mergeSettings, parseSettings } from "../lib/settings.ts";
import { FIELD_KEYS, formatDefault, formView, fromForm, parseLadder, toForm, toFormLoose } from "../lib/settings-form.ts";
import type { FieldKey } from "../lib/settings-form.ts";

const defaults = loadSettings();

test("multipliers show as percents without float noise and round-trip", () => {
  const f = toForm(defaults);
  assert.equal(f["sleeveMultipliers.VG+"], "95");
  assert.equal(f["sleeveMultipliers.VG"], "85");
  assert.equal(f["local.localDiscountMultiplier"], "80");
  assert.equal(f["local.defaultRegionMultiplier"], "100");
  assert.equal(f["offer.ladderPercents"], "30, 40, 50, 60");
  assert.equal(f["sell.floor"], "1");
  const r = fromForm({ ...f, "sleeveMultipliers.VG+": "95.5" });
  assert.ok(r.ok);
  assert.equal(r.value.sleeveMultipliers["VG+"], 0.955);
  const back = fromForm(f);
  assert.ok(back.ok);
  assert.deepEqual(back.value.sleeveMultipliers, defaults.sleeveMultipliers);
  assert.deepEqual(back.value.offer, defaults.offer);
  assert.equal(back.value.local.localDiscountMultiplier, 0.8);
});

test("toForm covers every field key", () => {
  assert.deepEqual(Object.keys(toForm(defaults)).sort(), [...FIELD_KEYS].sort());
});

test("empty and non-numeric fields are errors, never 0", () => {
  const r = fromForm({ ...toForm(defaults), "sell.floor": "", "offer.marginPercent": "abc", "sell.undercutPercent": "  " });
  assert.equal(r.ok, false);
  assert.equal(!r.ok && r.errors["sell.floor"], "Enter a number.");
  assert.equal(!r.ok && r.errors["offer.marginPercent"], "Enter a number.");
  assert.equal(!r.ok && r.errors["sell.undercutPercent"], "Enter a number.");
});

test("parseLadder accepts commas and spaces and rejects bad ladders", () => {
  assert.deepEqual(parseLadder(" 30,40  50 , 60 "), { ok: true, value: [30, 40, 50, 60] });
  assert.deepEqual(parseLadder("100"), { ok: true, value: [100] });
  for (const bad of ["", " , ", "30, x", "40, 30", "30, 30", "0, 40", "40, 101", "10 20 30 40 50 60 70 80 90"]) {
    assert.equal(parseLadder(bad).ok, false, bad);
  }
});

test("opening offer must be on the ladder", () => {
  const r = fromForm({ ...toForm(defaults), "offer.ladderPercents": "30, 50, 60", "offer.openingPercent": "40" });
  assert.equal(!r.ok && r.errors["offer.openingPercent"], "Pick an opening offer from the ladder.");
});

test("field limits mirror parseSettings", () => {
  const bad = (k: FieldKey, v: string) => {
    const r = fromForm({ ...toForm(defaults), [k]: v });
    return !r.ok && !!r.errors[k];
  };
  assert.ok(bad("sleeveMultipliers.NM", "0"));
  assert.ok(bad("sleeveMultipliers.NM", "151"));
  assert.ok(!bad("sleeveMultipliers.NM", "150"));
  assert.ok(bad("sell.undercutPercent", "100"));
  assert.ok(bad("sell.floor", "-1"));
  assert.ok(bad("local.discogsFeePercent", "-1"));
  assert.ok(bad("local.localDiscountMultiplier", "0"));
  assert.ok(bad("local.defaultRegionMultiplier", "0"));
  assert.ok(bad("offer.marginPercent", "100"));
  assert.ok(bad("offer.unverifiedSteps", "1.5"));
  assert.ok(bad("offer.unverifiedSteps", "4"));
  assert.ok(bad("offer.bulkEach", "-0.01"));
  assert.ok(bad("offer.overheadPerRecord", "-1"));
  assert.ok(bad("offer.pickThreshold", "-1"));
});

test("toFormLoose keeps well-typed saved values and defaults the rest", () => {
  const f = toFormLoose({ offer: { openingPercent: 45, marginPercent: "x" }, sell: null }, defaults);
  assert.equal(f["offer.openingPercent"], "45");
  assert.equal(f["offer.marginPercent"], "30");
  assert.equal(f["sell.floor"], toForm(defaults)["sell.floor"]);
  assert.deepEqual(toFormLoose("junk", defaults), toForm(defaults));
});

test("formatDefault shows units", () => {
  assert.equal(formatDefault("offer.openingPercent", defaults), "40%");
  assert.equal(formatDefault("sleeveMultipliers.VG+", defaults), "95%");
  assert.equal(formatDefault("offer.overheadPerRecord", defaults), "$1.50");
  assert.equal(formatDefault("offer.unverifiedSteps", defaults), "1");
  assert.equal(formatDefault("offer.ladderPercents", defaults), "30, 40, 50, 60");
});

test("every fromForm result passes parseSettings once merged over defaults", () => {
  const r = fromForm(toForm(defaults));
  assert.ok(r.ok);
  assert.doesNotThrow(() => parseSettings(mergeSettings(defaults, r.value)));
});

test("formView: a valid state loads clean; an invalid saved row is saveable with errors shown", () => {
  const ok = formView({ settings: defaults, defaults, invalid: null, savedRaw: null });
  assert.deepEqual(ok, { form: toForm(defaults), saveable: false, showErrors: false });
  const raw = { sleeveMultipliers: { VG: 2 } };
  const bad = formView({ settings: defaults, defaults, invalid: "settings: sleeveMultipliers.VG must be ...", savedRaw: raw });
  assert.equal(bad.form["sleeveMultipliers.VG"], "200");
  assert.equal(bad.saveable, true);
  assert.equal(bad.showErrors, true);
});

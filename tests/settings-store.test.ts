import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { openDb } from "../lib/db.ts";
import { loadSettings } from "../lib/settings.ts";
import { getSavedRaw, getSettings, resetSettings, saveSettings } from "../lib/settings-store.ts";

const defaults = loadSettings();
let db: DatabaseSync;
beforeEach(() => {
  db = openDb(":memory:");
});

test("no row gives the defaults", () => {
  const s = getSettings(db);
  assert.deepEqual(s.settings, defaults);
  assert.deepEqual(s.defaults, defaults);
  assert.equal(s.saved, false);
  assert.equal(s.updatedAt, null);
  assert.equal(s.invalid, null);
  assert.equal(getSavedRaw(db), null);
});

test("save then get round-trips; reset brings defaults back", () => {
  const out = saveSettings(db, { ...defaults, offer: { ...defaults.offer, marginPercent: 35 } }, undefined, 1000);
  assert.equal(out.offer.marginPercent, 35);
  const s = getSettings(db);
  assert.equal(s.settings.offer.marginPercent, 35);
  assert.equal(s.saved, true);
  assert.equal(s.updatedAt, 1000);
  resetSettings(db);
  assert.deepEqual(getSettings(db).settings, defaults);
  assert.equal(getSettings(db).saved, false);
});

test("an invalid save throws and leaves the stored row unchanged", () => {
  saveSettings(db, { offer: { marginPercent: 35 } });
  assert.throws(() => saveSettings(db, { offer: { marginPercent: 100 } }), /marginPercent/);
  assert.equal(getSettings(db).settings.offer.marginPercent, 35);
});

test("currency and region multipliers are never stored", () => {
  saveSettings(db, { discogs: { currency: "EUR" }, local: { regionMultipliers: { "415": 2 } } });
  // biome-ignore lint: test helper
  const raw = getSavedRaw(db) as Record<string, any>;
  assert.equal(raw.discogs?.currency, undefined);
  assert.equal(raw.local?.regionMultipliers, undefined);
  const s = getSettings(db).settings;
  assert.equal(s.discogs.currency, defaults.discogs.currency);
  assert.deepEqual(s.local.regionMultipliers, defaults.local.regionMultipliers);
});

test("a stored row that no longer validates falls back to defaults with a reason", () => {
  db.prepare("insert into settings (id, json, updated_at) values (1, ?, 5)").run(JSON.stringify({ offer: { openingPercent: 45 } }));
  const s = getSettings(db);
  assert.deepEqual(s.settings, defaults);
  assert.equal(s.saved, true);
  assert.equal(s.updatedAt, 5);
  assert.match(s.invalid ?? "", /openingPercent/);
});

test("corrupt JSON in the row falls back to defaults with a reason", () => {
  db.prepare("insert into settings (id, json, updated_at) values (1, '{not json', 5)").run();
  const s = getSettings(db);
  assert.deepEqual(s.settings, defaults);
  assert.ok(s.invalid);
  assert.equal(getSavedRaw(db), "{not json");
});

test("an invalid settings.json still throws", () => {
  assert.throws(() => getSettings(db, "/nonexistent/settings.json"));
});

test("cache hours are saved while currency still follows the file", () => {
  saveSettings(db, { discogs: { cacheHours: 6, currency: "EUR" } });
  const s = getSettings(db).settings;
  assert.equal(s.discogs.cacheHours, 6);
  assert.equal(s.discogs.currency, defaults.discogs.currency);
});

test("a saved row that is not an object is reported invalid", () => {
  for (const json of ["null", "[]", "5", '"x"']) {
    db.prepare("insert or replace into settings (id, json, updated_at) values (1, ?, 5)").run(json);
    const s = getSettings(db);
    assert.deepEqual(s.settings, defaults, json);
    assert.match(s.invalid ?? "", /not an object/, json);
  }
});

test("saving discogs: null is rejected with a settings message", () => {
  assert.throws(() => saveSettings(db, { discogs: null }), /^Error: settings: discogs\.cacheHours/);
});

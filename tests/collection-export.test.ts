import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buySheetRows, csvFilename, DISCOGS_GRADE, exportCounts, exportHint, toDiscogsCsv } from "../lib/collection/export.ts";
import { marketFor } from "../lib/collection/view.ts";
import { offerInputs } from "../lib/offer.ts";
import type { ItemRow } from "../lib/collection/types.ts";
import { priceRecord } from "../lib/pricing.ts";
import { parseSettings } from "../lib/settings.ts";
import type { Settings } from "../lib/types.ts";

const settings = parseSettings(JSON.parse(readFileSync("settings.json", "utf8")));
let nextId = 1;
const item = (o: Partial<ItemRow>): ItemRow => ({
  id: nextId++, sessionId: 1, query: "Q", year: null, record: "VG+", sleeve: "VG+", status: "pending",
  releaseId: null, release: null, candidates: null, suggestions: null, stats: null, pricedAt: null,
  error: null, createdAt: 0, pick: null, refresh: false, notes: "", ...o,
});
const HEADER = "release_id,price,media_condition,sleeve_condition,comments,status,external_id,private_notes";
const sugg = { NM: 40, "VG+": 30, VG: 20, "G+": 10 };
const priced = (o: Partial<ItemRow> = {}) => item({ status: "priced", releaseId: 101, suggestions: sugg, stats: null, ...o });
const withSell = (sell: Partial<Settings["sell"]>): Settings => ({ ...settings, sell: { ...settings.sell, ...sell } });

test("header and one row in Discogs wording at the sell price", () => {
  const it = priced({ id: 7, record: "VG+", sleeve: "VG" });
  const sell = priceRecord({ suggestions: sugg, lowestListing: null, record: "VG+", sleeve: "VG", settings })!.sell.price;
  assert.equal(
    toDiscogsCsv("Estate", [it], settings),
    `${HEADER}\r\n101,${sell.toFixed(2)},Very Good Plus (VG+),Very Good (VG),,Draft,mc-7,Estate\r\n`,
  );
});

test("every grade maps to Discogs wording", () => {
  assert.deepEqual(DISCOGS_GRADE, {
    M: "Mint (M)", NM: "Near Mint (NM or M-)", "VG+": "Very Good Plus (VG+)", VG: "Very Good (VG)",
    "G+": "Good Plus (G+)", G: "Good (G)", F: "Fair (F)", P: "Poor (P)",
  });
});

test("only priced rows with a release and a positive price are exported", () => {
  const rows = [
    priced({ id: 1 }),
    item({ id: 2, status: "no-match" }),
    item({ id: 3, status: "to-pick" }),
    item({ id: 4, status: "no-price", releaseId: 5 }),
    item({ id: 5, status: "error" }),
    item({ id: 6, status: "pending" }),
    item({ id: 8, status: "working" }),
    priced({ id: 9, releaseId: null }),
    priced({ id: 10, record: "P" }),
  ];
  const lines = toDiscogsCsv("L", rows, settings).trimEnd().split("\r\n");
  assert.equal(lines.length, 2);
  assert.match(lines[1], /,mc-1,/);
  assert.equal(toDiscogsCsv("L", [priced()], withSell({ undercutPercent: 99, floor: 0 })).split("\r\n").length, 3);
  assert.equal(toDiscogsCsv("L", [priced()], withSell({ undercutPercent: 100, floor: 0 })), `${HEADER}\r\n`);
});

test("lot names are quoted and formula-safe", () => {
  const row = (name: string) => toDiscogsCsv(name, [priced({ id: 1 })], settings).split("\r\n")[1];
  assert.match(row('Smith, "Jazz"'), /,"Smith, ""Jazz"""$/);
  assert.match(row("two\r\nlines\nhere"), /,mc-1,two lines here$/);
  assert.match(row("=SUM(A1)"), /,mc-1, =SUM\(A1\)$/);
  assert.match(row("@home"), /,mc-1, @home$/);
});

test("prices have exactly two decimals", () => {
  assert.match(toDiscogsCsv("L", [priced()], withSell({ undercutPercent: 99, floor: 12.5 })), /\r\n101,12\.50,/);
});

test("an empty lot is just the header", () => {
  assert.equal(toDiscogsCsv("L", [], settings), `${HEADER}\r\n`);
});

test("exportCounts", () => {
  const rows = [priced(), priced(), item({ status: "pending" }), item({ status: "working" }), item({ status: "no-match" })];
  assert.deepEqual(exportCounts(rows, settings), { exportable: 2, lookingUp: 2, skipped: 1 });
});

test("csvFilename slugs the lot name and falls back to the id", () => {
  assert.equal(csvFilename("Estate Sale — Oct 4!", 3), "estate-sale-oct-4-discogs.csv");
  assert.equal(csvFilename("Café ☕", 3), "caf-discogs.csv");
  assert.equal(csvFilename("!!!", 3), "collection-3-discogs.csv");
  assert.equal(csvFilename("a".repeat(100), 3), `${"a".repeat(60)}-discogs.csv`);
});

const INPUTS = offerInputs({ unverified: false, pickThreshold: 25, bulkEach: null, lotOverhead: 0 }, settings);
const rel = (o: object = {}) => ({ id: 101, title: "Blue", year: 1971, country: "US", label: "Atlantic", catno: "SD 1", format: "LP", thumb: null, ...o });

test("buy sheet: picks first, then suggested value high to low, unpriced last in lot order", () => {
  const rows = buySheetRows([
    item({ id: 1, status: "no-match" }),
    priced({ id: 2, record: "VG", sleeve: "VG" }),
    priced({ id: 3, record: "NM", sleeve: "NM" }),
    item({ id: 4, status: "to-pick" }),
    priced({ id: 5, record: "VG+", sleeve: "VG+" }),
    priced({ id: 6, record: "G+", sleeve: "G+" }),
  ], settings, INPUTS);
  assert.deepEqual(rows.map((r) => r.id), [3, 5, 2, 6, 1, 4]);
  assert.deepEqual(rows.map((r) => r.isPick), [true, true, false, false, false, false]);
  assert.deepEqual(rows.map((r) => r.statusLabel), [null, null, null, null, "No match", "To pick"]);
});

test("buy sheet row fields", () => {
  const it = priced({ id: 1, record: "VG+", sleeve: "VG", release: rel(), query: "SD 1" });
  const [r] = buySheetRows([it], settings, INPUTS);
  const p = priceRecord({ suggestions: sugg, lowestListing: null, record: "VG+", sleeve: "VG", settings })!;
  assert.deepEqual(r, {
    id: 1, releaseId: 101, query: "SD 1", title: "Blue", detail: "Atlantic · 1971", record: "VG+", sleeve: "VG",
    suggested: marketFor(it, settings)!.suggested, sell: p.sell.price, isPick: true, notes: "", statusLabel: null,
  });
  assert.equal(buySheetRows([priced({ release: rel({ label: "", year: null }) })], settings, INPUTS)[0].detail, "");
  assert.equal(buySheetRows([item({ status: "no-match" })], settings, INPUTS)[0].title, null);
  const label = (status: ItemRow["status"]) => buySheetRows([item({ status })], settings, INPUTS)[0].statusLabel;
  assert.equal(label("no-price"), "No price");
  assert.equal(label("error"), "Error");
  assert.equal(label("pending"), "Looking up");
  assert.equal(label("working"), "Looking up");
  const row = buySheetRows([item({ status: "no-price", releaseId: 5 })], settings, INPUTS)[0];
  assert.equal(row.suggested, null);
  assert.equal(row.sell, null);
});

test("exportHint", () => {
  assert.equal(exportHint({ exportable: 2, lookingUp: 1, skipped: 3 }), "2 to export · 1 still looking up · 3 can't be listed");
  assert.equal(exportHint({ exportable: 5, lookingUp: 0, skipped: 0 }), "5 to export");
  assert.equal(exportHint({ exportable: 0, lookingUp: 2, skipped: 1 }), "Nothing to export yet · 2 still looking up · 1 can't be listed");
  assert.equal(exportHint({ exportable: 0, lookingUp: 0, skipped: 4 }), "Nothing to export · 4 can't be listed");
  assert.equal(exportHint({ exportable: 0, lookingUp: 0, skipped: 0 }), "Nothing to export");
});

test("notes go to comments, quoted and formula-safe", () => {
  const row = (notes: string) => toDiscogsCsv("Estate", [priced({ id: 8, notes })], settings).split("\r\n")[1];
  assert.match(row('Seam split, "promo"'), /,Very Good Plus \(VG\+\),"Seam split, ""promo""",Draft,mc-8,Estate$/);
  assert.match(row("-light wear"), /,Very Good Plus \(VG\+\), -light wear,Draft,mc-8,Estate$/);
});

test("buy sheet rows carry notes", () => {
  assert.equal(buySheetRows([priced({ notes: "OBI" })], settings, INPUTS)[0].notes, "OBI");
  assert.equal(buySheetRows([priced()], settings, INPUTS)[0].notes, "");
});

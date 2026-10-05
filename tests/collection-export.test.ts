import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { csvFilename, DISCOGS_GRADE, exportCounts, toDiscogsCsv } from "../lib/collection/export.ts";
import type { ItemRow } from "../lib/collection/types.ts";
import { priceRecord } from "../lib/pricing.ts";
import { parseSettings } from "../lib/settings.ts";
import type { Settings } from "../lib/types.ts";

const settings = parseSettings(JSON.parse(readFileSync("settings.json", "utf8")));
let nextId = 1;
const item = (o: Partial<ItemRow>): ItemRow => ({
  id: nextId++, sessionId: 1, query: "Q", year: null, record: "VG+", sleeve: "VG+", status: "pending",
  releaseId: null, release: null, candidates: null, suggestions: null, stats: null, pricedAt: null,
  error: null, createdAt: 0, pick: null, refresh: false, ...o,
});
const HEADER = "release_id,price,media_condition,sleeve_condition,status,external_id,private_notes";
const sugg = { NM: 40, "VG+": 30, VG: 20, "G+": 10 };
const priced = (o: Partial<ItemRow> = {}) => item({ status: "priced", releaseId: 101, suggestions: sugg, stats: null, ...o });
const withSell = (sell: Settings["sell"]): Settings => ({ ...settings, sell });

test("header and one row in Discogs wording at the sell price", () => {
  const it = priced({ id: 7, record: "VG+", sleeve: "VG" });
  const sell = priceRecord({ suggestions: sugg, lowestListing: null, record: "VG+", sleeve: "VG", settings })!.sell.price;
  assert.equal(
    toDiscogsCsv("Estate", [it], settings),
    `${HEADER}\r\n101,${sell.toFixed(2)},Very Good Plus (VG+),Very Good (VG),Draft,mc-7,Estate\r\n`,
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
  assert.match(row("two\nlines"), /,"two\nlines"$/);
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
  assert.equal(csvFilename("!!!", 3), "lot-3-discogs.csv");
  assert.equal(csvFilename("a".repeat(100), 3), `${"a".repeat(60)}-discogs.csv`);
});

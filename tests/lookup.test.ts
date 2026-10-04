import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DiscogsError } from "../lib/discogs.ts";
import { httpStatus, missingEnv, parseLookupRequest, runLookup, toErrorResponse } from "../lib/lookup.ts";
import type { LookupClient, LookupRequest } from "../lib/lookup.ts";
import { parseSettings } from "../lib/settings.ts";
import type { Candidate, MarketplaceStats, PriceSuggestions } from "../lib/types.ts";

const settings = parseSettings(JSON.parse(readFileSync("settings.json", "utf8")));

const mk = (id: number, year: number | null = 1971): Candidate => ({
  id, title: `Release ${id}`, year, country: "US", label: "Atlantic", catno: "SD 7208", format: "Vinyl, LP", thumb: null,
});

function fakeClient(opts: {
  candidates?: Candidate[];
  suggestions?: PriceSuggestions | null;
  stats?: MarketplaceStats;
}) {
  const calls: string[] = [];
  const client: LookupClient = {
    async searchByCatno(catno, year) {
      calls.push(`search:${catno}:${year}`);
      return opts.candidates ?? [];
    },
    async priceSuggestions(id) {
      calls.push(`suggestions:${id}`);
      return opts.suggestions === undefined ? { "VG+": 30, VG: 20, NM: 40 } : opts.suggestions;
    },
    async marketplaceStats(id) {
      calls.push(`stats:${id}`);
      return opts.stats ?? { lowestPrice: 25, currency: "USD", numForSale: 4 };
    },
  };
  return { client, calls };
}

const req: LookupRequest = { catno: "SD 7208", year: 1971, record: "VG+", sleeve: "VG" };

test("parseLookupRequest accepts a full form and trims fields", () => {
  const r = parseLookupRequest({ catno: " SD 7208 ", year: "1971", record: "VG+", sleeve: "VG", areaCode: " 212 " });
  assert.deepEqual(r, {
    ok: true,
    value: { catno: "SD 7208", year: 1971, record: "VG+", sleeve: "VG", areaCode: "212", releaseId: undefined },
  });
});

test("parseLookupRequest treats blank year and area code as absent", () => {
  const r = parseLookupRequest({ catno: "X1", year: "", record: "NM", sleeve: "NM", areaCode: "  " });
  assert.ok(r.ok);
  assert.equal(r.value.year, undefined);
  assert.equal(r.value.areaCode, undefined);
});

test("parseLookupRequest rejects bad input with a readable message", () => {
  const bad = (body: unknown) => {
    const r = parseLookupRequest(body);
    assert.equal(r.ok, false);
  };
  bad(null);
  bad({ catno: "", record: "NM", sleeve: "NM" });
  bad({ catno: "X1", record: "EX", sleeve: "NM" });
  bad({ catno: "X1", year: "71", record: "NM", sleeve: "NM" });
  bad({ catno: "X1", record: "NM", sleeve: "NM", releaseId: "abc" });
});

test("parseLookupRequest allows a release id without a catalog number", () => {
  const r = parseLookupRequest({ releaseId: 4095902, record: "NM", sleeve: "VG+" });
  assert.ok(r.ok);
  assert.equal(r.value.releaseId, 4095902);
});

test("missingEnv names unset or blank vars only", () => {
  assert.deepEqual(missingEnv({}), ["DISCOGS_TOKEN", "DISCOGS_USER_AGENT"]);
  assert.deepEqual(missingEnv({ DISCOGS_TOKEN: "secret", DISCOGS_USER_AGENT: " " }), ["DISCOGS_USER_AGENT"]);
  assert.deepEqual(missingEnv({ DISCOGS_TOKEN: "secret", DISCOGS_USER_AGENT: "UA/1" }), []);
});

test("toErrorResponse maps 401 and 429 and never echoes a token", () => {
  const e401 = toErrorResponse(new DiscogsError("whatever", 401));
  assert.equal(e401.kind, "bad-token");
  assert.equal(httpStatus(e401), 502);
  const e429 = toErrorResponse(new DiscogsError("slow down", 429));
  assert.equal(e429.kind, "rate-limited");
  assert.equal(httpStatus(e429), 429);
  assert.equal(toErrorResponse(new DiscogsError("Discogs returned 500 for /x", 500)).kind, "upstream");
  assert.equal(toErrorResponse("weird").kind, "upstream");
});

test("runLookup returns no-match when the search is empty", async () => {
  const { client, calls } = fakeClient({ candidates: [] });
  assert.deepEqual(await runLookup(client, req, settings), { status: "no-match" });
  assert.deepEqual(calls, ["search:SD 7208:1971"]);
});

test("runLookup returns candidates without pricing when several pressings match", async () => {
  const { client, calls } = fakeClient({ candidates: [mk(1), mk(2)] });
  const res = await runLookup(client, req, settings);
  assert.equal(res.status, "candidates");
  assert.equal(calls.length, 1);
});

test("runLookup prices a single match straight away", async () => {
  const { client } = fakeClient({ candidates: [mk(7)] });
  const res = await runLookup(client, req, settings);
  assert.equal(res.status, "priced");
  if (res.status !== "priced") return;
  assert.equal(res.releaseId, 7);
  assert.equal(res.release?.id, 7);
  assert.equal(res.currency, "USD");
  assert.equal(res.result.market.suggested, 25.5); // 30 x VG sleeve 0.85
  assert.equal(res.result.sell.aboveLowestListing, false);
});

test("runLookup with a release id skips the search", async () => {
  const { client, calls } = fakeClient({});
  const res = await runLookup(client, { ...req, releaseId: 99 }, settings);
  assert.equal(res.status, "priced");
  assert.ok(!calls.some((c) => c.startsWith("search")));
  if (res.status === "priced") assert.equal(res.release, null);
});

test("runLookup distinguishes missing suggestions from a missing grade", async () => {
  const none = await runLookup(fakeClient({ suggestions: null }).client, { ...req, releaseId: 1 }, settings);
  assert.equal(none.status, "no-price");
  if (none.status === "no-price") assert.equal(none.reason, "no-suggestions");

  const grade = await runLookup(fakeClient({ suggestions: { NM: 40 } }).client, { ...req, releaseId: 1 }, settings);
  assert.equal(grade.status, "no-price");
  if (grade.status === "no-price") assert.equal(grade.reason, "grade-missing");
});

test("runLookup falls back to the settings currency when nothing is listed", async () => {
  const { client } = fakeClient({ stats: { lowestPrice: null, currency: null, numForSale: 0 } });
  const res = await runLookup(client, { ...req, releaseId: 1 }, settings);
  assert.equal(res.status, "priced");
  if (res.status === "priced") assert.equal(res.currency, settings.discogs.currency);
});

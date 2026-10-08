import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setupMissing } from "../lib/discogs-access.ts";
import { DiscogsError } from "../lib/discogs.ts";
import { live } from "./helpers/live-client.ts";
import type { Method } from "./helpers/live-client.ts";
import { discogsReady, httpStatus, parseLookupRequest, runLookup, toErrorResponse } from "../lib/lookup.ts";
import type { LookupClient, LookupRequest } from "../lib/lookup.ts";
import { parseSettings } from "../lib/settings.ts";
import type { Candidate, MarketplaceStats, PriceSuggestions } from "../lib/types.ts";

const settings = parseSettings(JSON.parse(readFileSync("settings.json", "utf8")));

const mk = (id: number, year: number | null = 1971): Candidate => ({
  id, title: `Release ${id}`, year, country: "US", label: "Atlantic", catno: "SD 7208", format: "Vinyl, LP", thumb: null,
});

function fakeClient(
  opts: {
    candidates?: Candidate[];
    suggestions?: PriceSuggestions | null;
    stats?: MarketplaceStats;
  },
  fetchedAt: (method: Method) => number = () => 0,
  seen?: { fresh: (boolean | undefined)[] },
) {
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
    async releaseStats(id) {
      calls.push(`release:${id}`);
      return opts.stats ?? { lowestPrice: 25, currency: "USD", numForSale: 4 };
    },
  };
  return { client: live(client, fetchedAt, seen), calls };
}

const req: LookupRequest = { catno: "SD 7208", year: 1971, record: "VG+", sleeve: "VG" };

test("parseLookupRequest accepts a full form and trims fields", () => {
  const r = parseLookupRequest({ catno: " SD 7208 ", year: "1971", record: "VG+", sleeve: "VG" });
  assert.deepEqual(r, {
    ok: true,
    value: { catno: "SD 7208", year: 1971, record: "VG+", sleeve: "VG", releaseId: undefined },
  });
});

test("parseLookupRequest treats a blank year as absent and ignores an old client's area code", () => {
  const r = parseLookupRequest({ catno: "X1", year: "", record: "NM", sleeve: "NM", areaCode: "212" });
  assert.ok(r.ok);
  assert.equal(r.value.year, undefined);
  assert.equal("areaCode" in r.value, false);
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

test("discogsReady is null for token and oauth access", () => {
  assert.equal(discogsReady({ kind: "token", token: "t" }, {}), null);
  assert.equal(discogsReady({ kind: "oauth", consumerKey: "k", consumerSecret: "s", token: "t", secret: "x", username: "u" }, {}), null);
});

test("discogsReady: not connected is a 409 with the connect message", () => {
  const r = discogsReady({ kind: "none", reason: "not-connected" }, {});
  assert.deepEqual(r, { status: "error", kind: "not-connected", message: "Connect your Discogs account to start pricing." });
  assert.equal(httpStatus(r!), 409);
});

test("discogsReady: setup names the missing settings, never values", () => {
  const r = discogsReady({ kind: "none", reason: "setup" }, { DISCOGS_CONSUMER_KEY: "keyvalue" });
  assert.equal(r?.kind, "missing-env");
  assert.match(r!.message, /DISCOGS_TOKEN/);
  assert.match(r!.message, /DISCOGS_USER_AGENT/);
  assert.doesNotMatch(r!.message, /keyvalue/);
  assert.deepEqual(setupMissing({ DISCOGS_TOKEN: "secret", DISCOGS_USER_AGENT: "UA/1" }), []);
});

test("toErrorResponse maps a not-connected DiscogsError and the setup error", () => {
  const e = new DiscogsError("x", 0);
  e.kind = "not-connected";
  assert.deepEqual(toErrorResponse(e), { status: "error", kind: "not-connected", message: "Connect your Discogs account to start pricing." });
  assert.equal(toErrorResponse(new DiscogsError("Discogs isn't set up for this app.", 0)).kind, "missing-env");
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

test("runLookup reports cached prices and their age", async () => {
  const { client } = fakeClient({ candidates: [mk(1)] }, () => 1000);
  const res = await runLookup(client, req, settings, () => 5000);
  assert.equal(res.status, "priced");
  assert.equal(res.status === "priced" && res.cached, true);
  assert.equal(res.status === "priced" && res.fetchedAt, 1000);
});

test("fresh data is not reported as cached", async () => {
  const { client } = fakeClient({ candidates: [mk(1)] }, () => 5000);
  const res = await runLookup(client, req, settings, () => 5000);
  assert.equal(res.status === "priced" && res.cached, false);
});

test("no-price results carry cached and fetchedAt too", async () => {
  const { client } = fakeClient({ candidates: [mk(1)], suggestions: null }, () => 1000);
  const res = await runLookup(client, req, settings, () => 5000);
  assert.equal(res.status, "no-price");
  assert.equal(res.status === "no-price" && res.cached, true);
});

test("fresh reaches suggestions and stats but not search", async () => {
  const seen = { fresh: [] as (boolean | undefined)[] };
  const { client } = fakeClient({}, () => 0, seen);
  await runLookup(client, { ...req, releaseId: 9, fresh: true }, settings);
  assert.deepEqual(seen.fresh, [true, true]);
  const seen2 = { fresh: [] as (boolean | undefined)[] };
  await runLookup(fakeClient({ candidates: [mk(1)] }, () => 0, seen2).client, req, settings);
  assert.deepEqual(seen2.fresh, [undefined, undefined, undefined]);
});

test("fetchedAt is the older of suggestions and stats", async () => {
  const { client } = fakeClient({}, (m) => (m === "suggestions" ? 2000 : 1000));
  const res = await runLookup(client, { ...req, releaseId: 9 }, settings, () => 5000);
  assert.equal(res.status === "priced" && res.fetchedAt, 1000);
});

test("parseLookupRequest accepts fresh as a boolean, with or without a release id", () => {
  const b = { catno: "X", record: "NM", sleeve: "NM" };
  const ok = parseLookupRequest({ ...b, releaseId: 5, fresh: true });
  assert.equal(ok.ok && ok.value.fresh, true);
  const search = parseLookupRequest({ ...b, fresh: true });
  assert.equal(search.ok && search.value.fresh, true);
  assert.equal(parseLookupRequest({ ...b, releaseId: 5, fresh: "yes" }).ok, false);
  const plain = parseLookupRequest({ ...b, releaseId: 5 });
  assert.equal(plain.ok && plain.value.fresh, undefined);
});

test("a fresh search skips the cache for the search and the prices", async () => {
  const seen = { fresh: [] as (boolean | undefined)[] };
  const { client } = fakeClient({ candidates: [mk(1)] }, () => 0, seen);
  await runLookup(client, { ...req, fresh: true }, settings);
  assert.deepEqual(seen.fresh, [true, true, true]);
});

test("runLookup labels prices with the settings currency, whatever the release reports", async () => {
  const { client } = fakeClient({ stats: { lowestPrice: 9, currency: "EUR", numForSale: 2 } });
  const res = await runLookup(client, { ...req, releaseId: 1 }, settings);
  assert.equal(res.status, "priced");
  if (res.status === "priced") assert.equal(res.currency, settings.discogs.currency);
});

test("a no-price result also carries the settings currency for its lowest listing", async () => {
  const res = await runLookup(fakeClient({ suggestions: null, stats: { lowestPrice: 9, currency: null, numForSale: 2 } }).client, { ...req, releaseId: 1 }, settings);
  assert.equal(res.status, "no-price");
  if (res.status === "no-price") assert.equal(res.currency, settings.discogs.currency);
});

test("a priced lookup says how fast the record sells", async () => {
  const { client } = fakeClient({ stats: { lowestPrice: 9, currency: null, numForSale: 3, have: 10, want: 30 } });
  const res = await runLookup(client, { ...req, releaseId: 1 }, settings);
  assert.equal(res.status, "priced");
  if (res.status === "priced") assert.equal(res.demand, "fast");
});

test("toErrorResponse: a reconnect 401 keeps its message; a plain 401 keeps the DISCOGS_TOKEN text", () => {
  const msg = "Discogs no longer accepts this app's access. Reconnect Discogs in Settings.";
  assert.deepEqual(toErrorResponse(new DiscogsError(msg, 401, "reconnect")), { status: "error", kind: "bad-token", message: msg });
  assert.match(toErrorResponse(new DiscogsError("x", 401)).message, /DISCOGS_TOKEN/);
});

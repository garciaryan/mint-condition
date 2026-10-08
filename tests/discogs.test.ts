import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DiscogsClient,
  DiscogsError,
  barcodeDigits,
  barcodeVariants,
  catnoVariants,
  filterByYear,
  parsePriceSuggestions,
  parseReleaseStats,
  sortByYear,
  toCandidate,
  toVersion,
} from "../lib/discogs.ts";

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" }, ...init });
}

function makeClient(handler: (url: URL) => Response | Promise<Response>) {
  const calls: URL[] = [];
  const sleeps: number[] = [];
  let t = 0;
  const client = new DiscogsClient({
    token: "tok",
    userAgent: "Test/1.0",
    fetchImpl: (async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      calls.push(url);
      return handler(url);
    }) as typeof fetch,
    sleep: async (ms) => {
      sleeps.push(ms);
      t += ms;
    },
    now: () => t,
  });
  return { client, calls, sleeps };
}

test("catnoVariants covers spacing, dash and boundary forms without duplicates", () => {
  const v = catnoVariants("SD7208");
  assert.equal(v[0], "SD7208");
  assert.ok(v.includes("SD 7208"));
  assert.ok(v.includes("SD-7208"));
  assert.equal(new Set(v.map((x) => x.toLowerCase())).size, v.length);

  const w = catnoVariants("  sd  7208 ");
  assert.equal(w[0], "sd 7208");
  assert.ok(w.includes("sd7208"));
  assert.ok(w.includes("sd-7208"));

  assert.deepEqual(catnoVariants("   "), []);
});

test("barcodeDigits accepts valid UPC/EAN codes with spaces or dashes", () => {
  assert.equal(barcodeDigits("036000291452"), "036000291452"); // UPC-A
  assert.equal(barcodeDigits("0 36000 29145 2"), "036000291452");
  assert.equal(barcodeDigits("4006381333931"), "4006381333931"); // EAN-13
  assert.equal(barcodeDigits("4-006381-333931"), "4006381333931");
  assert.equal(barcodeDigits("73513537"), "73513537"); // EAN-8
  assert.equal(barcodeDigits("00036000291452"), "00036000291452"); // GTIN-14
});

test("barcodeDigits rejects catnos, wrong lengths and bad check digits", () => {
  assert.equal(barcodeDigits("SD 7208"), null);
  assert.equal(barcodeDigits("2383 046"), null); // 7-digit numeric catno
  assert.equal(barcodeDigits("036000291453"), null); // check digit off by one
  assert.equal(barcodeDigits("12345678901"), null); // 11 digits
  assert.equal(barcodeDigits(""), null);
});

test("barcodeVariants pairs UPC-A with its EAN-13 form", () => {
  assert.deepEqual(barcodeVariants("036000291452"), ["036000291452", "0036000291452"]);
  assert.deepEqual(barcodeVariants("0036000291452"), ["0036000291452", "036000291452"]);
  assert.deepEqual(barcodeVariants("4006381333931"), ["4006381333931"]);
});

test("searchByCatno searches a barcode by barcode first, then its other form", async () => {
  const { client, calls } = makeClient((url) =>
    url.searchParams.get("barcode") === "0036000291452" ? json({ results: [{ id: 7, year: "1971" }] }) : json({ results: [] }),
  );
  const found = await client.searchByCatno("0 36000 29145 2", 1971);
  assert.deepEqual(found.map((c) => c.id), [7]);
  assert.deepEqual(calls.map((u) => [u.searchParams.get("barcode"), u.searchParams.get("catno")]), [
    ["036000291452", null],
    ["0036000291452", null],
  ]);
});

test("searchByCatno falls back to a catno search when the barcode finds nothing", async () => {
  const { client, calls } = makeClient((url) =>
    url.searchParams.get("catno") ? json({ results: [{ id: 3, year: "1971" }] }) : json({ results: [] }),
  );
  const found = await client.searchByCatno("73513537", 1971);
  assert.deepEqual(found.map((c) => c.id), [3]);
  assert.equal(calls[0].searchParams.get("barcode"), "73513537");
  assert.equal(calls[1].searchParams.get("catno"), "73513537");
});

test("searchByCatno never sends a barcode query for an ordinary catno", async () => {
  const { client, calls } = makeClient(() => json({ results: [{ id: 1, year: "1971" }] }));
  await client.searchByCatno("SD 7208", 1971);
  assert.ok(calls.every((u) => !u.searchParams.has("barcode")));
});

test("filterByYear keeps close years and unknown years", () => {
  const mk = (id: number, year: number | null) => ({
    id, title: "", year, country: null, label: null, catno: null, format: null, thumb: null,
  });
  const list = [mk(1, 1971), mk(2, 1972), mk(3, 1980), mk(4, null)];
  assert.deepEqual(filterByYear(list, 1971).map((c) => c.id), [1, 2, 4]);
  assert.deepEqual(filterByYear(list, 1971, 0).map((c) => c.id), [1, 4]);
  assert.equal(filterByYear(list, undefined).length, 4);
});

test("sortByYear puts exact years first, then near years, then unknown years, keeping order within each", () => {
  const mk = (id: number, year: number | null) => ({
    id, title: "", year, country: null, label: null, catno: null, format: null, thumb: null,
  });
  const list = [mk(1, null), mk(2, 1972), mk(3, 1971), mk(4, null), mk(5, 1970), mk(6, 1971)];
  assert.deepEqual(sortByYear(list, 1971).map((c) => c.id), [3, 6, 2, 5, 1, 4]);
  assert.deepEqual(sortByYear(list, undefined).map((c) => c.id), [1, 2, 3, 4, 5, 6]);
});

test("toCandidate handles string, missing and empty years", () => {
  assert.equal(toCandidate({ id: 1, year: "1971" }).year, 1971);
  assert.equal(toCandidate({ id: 1 }).year, null);
  assert.equal(toCandidate({ id: 1, year: "" }).year, null);
  const c = toCandidate({ id: 9, title: "A - B", label: ["Blue Note"], format: ["Vinyl", "LP"], thumb: "" });
  assert.equal(c.label, "Blue Note");
  assert.equal(c.format, "Vinyl, LP");
  assert.equal(c.thumb, null);
});

test("parsePriceSuggestions maps Discogs keys to grades and skips missing ones", () => {
  const out = parsePriceSuggestions({
    "Mint (M)": { value: 50 },
    "Near Mint (NM or M-)": { value: 40.5 },
    "Very Good Plus (VG+)": { value: 30 },
    "Poor (P)": undefined,
  });
  assert.deepEqual(out, { M: 50, NM: 40.5, "VG+": 30 });
});

test("searchByCatno falls through variants and filters by year", async () => {
  const { client, calls } = makeClient((url) => {
    if (url.searchParams.get("catno") === "SD7208") return json({ results: [] });
    return json({
      results: [
        { id: 1, year: "1971", title: "Right pressing" },
        { id: 2, year: "1999", title: "Reissue" },
      ],
    });
  });
  const found = await client.searchByCatno("SD7208", 1971);
  assert.deepEqual(found.map((c) => c.id), [1]);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].searchParams.get("type"), "release");
});

test("searchByCatno follows pagination up to the page cap and sorts by year", async () => {
  const { client, calls } = makeClient((url) => {
    const page = Number(url.searchParams.get("page"));
    return json({
      pagination: { page, pages: 5 },
      results: [
        { id: page * 10 + 1, year: "" },
        { id: page * 10 + 2, year: "1971" },
      ],
    });
  });
  const found = await client.searchByCatno("SD 7208", 1971, 1, 3);
  assert.equal(calls.length, 3);
  assert.deepEqual(calls.map((u) => u.searchParams.get("page")), ["1", "2", "3"]);
  assert.equal(calls[0].searchParams.get("per_page"), "100");
  assert.deepEqual(found.map((c) => c.id), [12, 22, 32, 11, 21, 31]);
});

test("searchByCatno stops paging when the last page is reached", async () => {
  const { client, calls } = makeClient(() => json({ pagination: { page: 1, pages: 1 }, results: [{ id: 1, year: "1971" }] }));
  await client.searchByCatno("SD 7208", 1971);
  assert.equal(calls.length, 1);
});

test("searchByCatno returns [] when nothing matches", async () => {
  const { client } = makeClient(() => json({ results: [{ id: 5, year: "2001" }] }));
  assert.deepEqual(await client.searchByCatno("XYZ 1", 1971), []);
});

test("requests carry the auth header and user agent", async () => {
  let seen: Headers | undefined;
  const client = new DiscogsClient({
    token: "secret",
    userAgent: "Test/1.0",
    fetchImpl: (async (_u: unknown, init?: RequestInit) => {
      seen = new Headers(init?.headers);
      return json({ num_for_sale: 3, lowest_price: 12.5 });
    }) as typeof fetch,
    sleep: async () => {},
  });
  const stats = await client.releaseStats(42);
  assert.equal(seen?.get("authorization"), "Discogs token=secret");
  assert.equal(seen?.get("user-agent"), "Test/1.0");
  assert.deepEqual(stats, { lowestPrice: 12.5, currency: null, numForSale: 3, masterId: null, identifiers: [] });
});

test("releaseStats asks /releases/{id}; a missing release has nothing for sale", async () => {
  const { client, calls } = makeClient(() => new Response("{}", { status: 404 }));
  assert.deepEqual(await client.releaseStats(42), { lowestPrice: null, currency: null, numForSale: 0 });
  assert.equal(calls[0].pathname, "/releases/42");
});

test("toVersion reads the year from released and maps the fields", () => {
  const raw = { id: 5193282, title: "Blue Train", label: "Blue Note", catno: "BLP 1577", country: "US", format: "LP, Album, Mono", thumb: "" };
  assert.deepEqual(toVersion({ ...raw, released: "1958" }), {
    id: 5193282, title: "Blue Train", year: 1958, country: "US", label: "Blue Note", catno: "BLP 1577", format: "LP, Album, Mono", thumb: null,
  });
  assert.equal(toVersion({ ...raw, released: "1972-05-12" }).year, 1972);
  for (const released of ["0", "", "Unknown", undefined]) assert.equal(toVersion({ ...raw, released }).year, null, String(released));
  assert.deepEqual(toVersion({ id: 1 }), { id: 1, title: "", year: null, country: null, label: null, catno: null, format: null, thumb: null });
});

const versionsPage = (page: number, pages: number, items: number, n = 100) =>
  json({ pagination: { page, pages, items }, versions: Array.from({ length: n }, (_, i) => ({ id: page * 1000 + i, released: "1958" })) });

test("masterVersions sends the vinyl filter and release-date sort", async () => {
  const { client, calls } = makeClient(() => versionsPage(1, 1, 3, 3));
  await client.masterVersions(32208);
  const u = calls[0];
  assert.equal(u.pathname, "/masters/32208/versions");
  for (const [k, v] of Object.entries({ format: "Vinyl", sort: "released", sort_order: "asc", per_page: "100", page: "1" })) {
    assert.equal(u.searchParams.get(k), v, k);
  }
});

test("masterVersions follows pages up to 3 and reports the total", async () => {
  const { client, calls } = makeClient((u) => versionsPage(Number(u.searchParams.get("page")), 5, 412));
  const { versions, total } = await client.masterVersions(32208);
  assert.equal(calls.length, 3);
  assert.equal(versions.length, 300);
  assert.equal(total, 412);
});

test("masterVersions stops at the last page", async () => {
  const { client, calls } = makeClient((u) => versionsPage(Number(u.searchParams.get("page")), 2, 150, 75));
  const { versions, total } = await client.masterVersions(32208);
  assert.equal(calls.length, 2);
  assert.equal(versions.length, 150);
  assert.equal(total, 150);
});

test("masterVersions of a missing master is empty", async () => {
  const { client } = makeClient(() => new Response("{}", { status: 404 }));
  assert.deepEqual(await client.masterVersions(1), { versions: [], total: 0 });
});

test("parseReleaseStats reads the live Blue Train release", () => {
  const body = JSON.parse(readFileSync("tests/fixtures/release-5193282.json", "utf8"));
  assert.deepEqual(parseReleaseStats(body), {
    lowestPrice: 475, currency: null, numForSale: 6, have: 878, want: 3357, masterId: 32208, identifiers: body.identifiers,
  });
});

test("parseReleaseStats leaves out what a release doesn't have", () => {
  const parsed = parseReleaseStats({ num_for_sale: 0, lowest_price: null, community: {}, master_id: 0, identifiers: [{ type: "x" }] });
  assert.deepEqual(parsed, { lowestPrice: null, currency: null, numForSale: 0, masterId: null, identifiers: [] });
  assert.equal("have" in parsed, false);
  assert.deepEqual(parseReleaseStats(null), { lowestPrice: null, currency: null, numForSale: 0 });
});

test("priceSuggestions returns null on 404 or empty bodies", async () => {
  const a = makeClient(() => new Response("", { status: 404 }));
  assert.equal(await a.client.priceSuggestions(1), null);
  const b = makeClient(() => json({}));
  assert.equal(await b.client.priceSuggestions(1), null);
});

test("401 raises a helpful DiscogsError", async () => {
  const { client } = makeClient(() => new Response("", { status: 401 }));
  await assert.rejects(client.priceSuggestions(1), (e: unknown) => e instanceof DiscogsError && e.status === 401);
});

test("429 waits for Retry-After and retries once", async () => {
  let n = 0;
  const { client, sleeps } = makeClient(() => {
    n++;
    return n === 1
      ? new Response("", { status: 429, headers: { "Retry-After": "7" } })
      : json({ "Mint (M)": { value: 9 } });
  });
  assert.deepEqual(await client.priceSuggestions(1), { M: 9 });
  assert.equal(n, 2);
  assert.ok(sleeps.includes(7000));
});

test("a second 429 surfaces as an error", async () => {
  const { client } = makeClient(() => new Response("", { status: 429, headers: { "Retry-After": "1" } }));
  await assert.rejects(client.priceSuggestions(1), (e: unknown) => e instanceof DiscogsError && e.status === 429);
});

test("requests are spaced to respect the rate limit", async () => {
  const { client, sleeps } = makeClient(() => json({ num_for_sale: 0, lowest_price: null }));
  await Promise.all([client.releaseStats(1), client.releaseStats(2), client.releaseStats(3)]);
  const waits = sleeps.filter((s) => s > 0);
  assert.equal(waits.length, 2);
  assert.ok(waits.every((w) => w >= 1000 && w <= 1100));
});

test("constructor requires a token and a user agent", () => {
  assert.throws(() => new DiscogsClient({ token: "", userAgent: "x" }));
  assert.throws(() => new DiscogsClient({ token: "x", userAgent: "" }));
});

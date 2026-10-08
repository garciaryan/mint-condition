import { test } from "node:test";
import assert from "node:assert/strict";
import { earliestYear, filterVersions, sortVersions, thisCopyYear, versionFlag, withArtist, paginate, pageOf, VERSIONS_PAGE_SIZE } from "../lib/versions.ts";
import type { Candidate } from "../lib/types.ts";

const v = (id: number, year: number | null, extra: Partial<Candidate> = {}): Candidate => ({
  id,
  title: "Blue Train",
  year,
  country: "US",
  label: "Blue Note",
  catno: "BLP 1577",
  format: "LP, Album",
  thumb: null,
  ...extra,
});

const list = [v(1, 1972), v(2, null), v(3, 1958), v(4, 1958)];

test("sortVersions puts years ascending and unknown years last, keeping order within a year", () => {
  assert.deepEqual(sortVersions(list).map((x) => x.id), [3, 4, 1, 2]);
  assert.deepEqual(list.map((x) => x.id), [1, 2, 3, 4], "input unchanged");
});

test("earliestYear is the smallest known year, or null", () => {
  assert.equal(earliestYear(list), 1958);
  assert.equal(earliestYear([v(1, null)]), null);
  assert.equal(earliestYear([]), null);
});

test("versionFlag says earliest or reissue, and nothing when a year is unknown", () => {
  assert.equal(versionFlag(1958, 1958), "earliest");
  assert.equal(versionFlag(1972, 1958), "reissue");
  assert.equal(versionFlag(1950, 1958), "earliest");
  assert.equal(versionFlag(null, 1958), null);
  assert.equal(versionFlag(1972, null), null);
});

test("thisCopyYear comes from the list, else the fallback", () => {
  assert.equal(thisCopyYear(list, 1, 2000), 1972);
  assert.equal(thisCopyYear(list, 99, 1965), 1965);
  assert.equal(thisCopyYear(list, 2, 1965), 1965, "found, but no year");
  assert.equal(thisCopyYear(list, 99, null), null);
});

test("filterVersions matches label, catno, country, format and year, ignoring case", () => {
  const vs = [
    v(1, 1958, { label: "Blue Note", catno: "BLP 1577", format: "LP, Album, Mono" }),
    v(2, 1977, { label: "King Records", catno: "GXK 8001", country: "JP", format: "LP, Album, Reissue, Stereo" }),
  ];
  const ids = (text: string) => filterVersions(vs, text).map((x) => x.id);
  assert.deepEqual(ids("blue note"), [1]);
  assert.deepEqual(ids("1577"), [1]);
  assert.deepEqual(ids("jp"), [2]);
  assert.deepEqual(ids("mono"), [1]);
  assert.deepEqual(ids("1958"), [1]);
  assert.deepEqual(ids("  "), [1, 2]);
});

test("withArtist keeps the card's artist on a version's bare title", () => {
  assert.equal(withArtist("John Coltrane - Blue Train", "Blue Train"), "John Coltrane - Blue Train");
  assert.equal(withArtist("John Coltrane - Blue Train", "Blue Train (Remastered)"), "John Coltrane - Blue Train (Remastered)");
  assert.equal(withArtist("Blue Train", "Blue Train"), "Blue Train", "no artist on the card");
  assert.equal(withArtist(null, "Blue Train"), "Blue Train");
  assert.equal(withArtist("John Coltrane - Blue Train", "John Coltrane - Blue Train"), "John Coltrane - Blue Train", "already has one");
  assert.equal(withArtist("John Coltrane - Blue Train", ""), "John Coltrane - Blue Train", "no title: keep the card's");
});

test("versions show 20 to a page", () => {
  assert.equal(VERSIONS_PAGE_SIZE, 20);
});

test("paginate slices a page and counts the pages", () => {
  const xs = Array.from({ length: 45 }, (_, i) => i);
  assert.deepEqual(paginate(xs, 1, 20), { items: xs.slice(0, 20), page: 1, pages: 3 });
  assert.deepEqual(paginate(xs, 3, 20), { items: [40, 41, 42, 43, 44], page: 3, pages: 3 });
});

test("paginate clamps pages out of range, and an empty list is one empty page", () => {
  const xs = Array.from({ length: 45 }, (_, i) => i);
  assert.equal(paginate(xs, 9, 20).page, 3);
  assert.equal(paginate(xs, 0, 20).page, 1);
  assert.deepEqual(paginate([], 2, 20), { items: [], page: 1, pages: 1 });
});

test("pageOf gives the 1-based page holding an index; a missing index is page 1", () => {
  assert.equal(pageOf(0, 20), 1);
  assert.equal(pageOf(19, 20), 1);
  assert.equal(pageOf(20, 20), 2);
  assert.equal(pageOf(-1, 20), 1);
});

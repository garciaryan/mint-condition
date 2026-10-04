import { test } from "node:test";
import assert from "node:assert/strict";
import { fieldErrors, groupCandidates } from "../lib/form.ts";
import type { Candidate } from "../lib/types.ts";

const mk = (id: number, year: number | null, country = "US", format = "Vinyl, LP"): Candidate => ({
  id, title: `Release ${id}`, year, country, label: "Atlantic", catno: "SD 7208", format, thumb: null,
});

test("fieldErrors: valid input has no errors", () => {
  assert.deepEqual(fieldErrors("SD 7208", "1971"), {});
  assert.deepEqual(fieldErrors("SD 7208", "  "), {});
});

test("fieldErrors: blank catno", () => {
  assert.equal(fieldErrors("  ", "").catno, "Enter a catalog number or barcode.");
});

test("fieldErrors: bad years match the server's range", () => {
  for (const y of ["71", "19711", "abcd", "1889", "2101", "1971.5"]) assert.ok(fieldErrors("x", y).year, y);
  for (const y of ["1890", "2100", " 1971 "]) assert.equal(fieldErrors("x", y).year, undefined, y);
});

test("groupCandidates: groups by exact year, nearby, unknown; drops empty groups", () => {
  const groups = groupCandidates([mk(1, 1971), mk(2, 1972), mk(3, null), mk(4, 1971)], "", 1971);
  assert.deepEqual(
    groups.map((g) => [g.title, g.items.map((c) => c.id)]),
    [["1971", [1, 4]], ["Within a year", [2]], ["Year unknown", [3]]],
  );
  assert.deepEqual(groupCandidates([mk(1, null)], "", 1971).map((g) => g.title), ["Year unknown"]);
});

test("groupCandidates: no year gives one group", () => {
  assert.deepEqual(groupCandidates([mk(1, 1971), mk(2, null)], "").map((g) => [g.title, g.items.length]), [["All pressings", 2]]);
});

test("groupCandidates: filter matches any field, case-insensitive", () => {
  const list = [mk(1, 1971, "UK"), mk(2, 1971, "US", "Vinyl, LP, Club Edition"), mk(3, 1972, "Germany")];
  assert.deepEqual(groupCandidates(list, "uk").flatMap((g) => g.items.map((c) => c.id)), [1]);
  assert.deepEqual(groupCandidates(list, "CLUB").flatMap((g) => g.items.map((c) => c.id)), [2]);
  assert.deepEqual(groupCandidates(list, "1972").flatMap((g) => g.items.map((c) => c.id)), [3]);
  assert.deepEqual(groupCandidates(list, "zzz"), []);
});

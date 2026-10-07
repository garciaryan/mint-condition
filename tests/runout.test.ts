import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { checkPlan, matchIdentifiers, normalizeRunout, RUNOUT_CHECK_CAP, uncheckedCount } from "../lib/runout.ts";
import type { Identifier } from "../lib/types.ts";

const B: Identifier[] = JSON.parse(readFileSync("tests/fixtures/release-5193282.json", "utf8")).identifiers;
const values = (q: string) => matchIdentifiers(B, q).map((h) => h.identifier.value);

test("normalizeRunout keeps letters and digits, uppercased", () => {
  assert.equal(normalizeRunout("RVG BN-LP-1577-A... 9 M"), "RVGBNLP1577A9M");
  assert.equal(normalizeRunout("-- ."), "");
});

test("matchIdentifiers searches every identifier value, ignoring case and punctuation", () => {
  assert.deepEqual(values("1577a"), ["BN 1577-A", "RVG BN-LP-1577-A... 9 M"]);
  assert.deepEqual(values("rvg"), ["RVG BN-LP-1577-A... 9 M", "RVG BN-LP-1577-B... 9 M"]);
  assert.deepEqual(values("bmi"), ["BMI"]);
  assert.deepEqual(values("zzz"), []);
});

test("highlight ranges land on the original characters, every occurrence", () => {
  const one = matchIdentifiers([{ type: "Matrix / Runout", value: "BN 1577-A" }], "1577a");
  assert.deepEqual(one[0].ranges, [[3, 9]]);
  const twice = matchIdentifiers([{ type: "Matrix / Runout", value: "A1 A-1" }], "a1");
  assert.deepEqual(twice[0].ranges, [[0, 2], [3, 6]]);
});

test("an empty or punctuation-only query matches everything, unhighlighted", () => {
  for (const q of ["", "-- ."]) {
    const all = matchIdentifiers(B, q);
    assert.equal(all.length, 5);
    assert.ok(all.every((h) => h.ranges.length === 0));
  }
});

test("checkPlan: check what's showing and not loaded, up to 25 showing", () => {
  const ids = (n: number) => Array.from({ length: n }, (_, i) => i + 1);
  assert.equal(RUNOUT_CHECK_CAP, 25);
  assert.deepEqual(checkPlan(ids(25), new Set()), { toCheck: ids(25), overCap: false });
  assert.equal(checkPlan(ids(26), new Set()).overCap, true);
  assert.deepEqual(checkPlan([1, 2, 3], new Set([2])).toCheck, [1, 3]);
});

test("uncheckedCount counts showing pressings without loaded runouts", () => {
  assert.equal(uncheckedCount([1, 2, 3], new Set([2])), 2);
  assert.equal(uncheckedCount([], new Set()), 0);
});

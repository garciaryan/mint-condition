import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { checkPlan, isExpanded, matchIdentifiers, normalizeRunout, RUNOUT_CHECK_CAP, runoutCounts, searchVisible, toggleExpanded, uncheckedCount } from "../lib/runout.ts";
import type { RunoutState } from "../lib/runout.ts";
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

const loadedS = (identifiers: Identifier[]): RunoutState => ({ status: "loaded", identifiers });
const failed: RunoutState = { status: "error", message: "Discogs is rate-limiting; try again shortly." };

test("while searching, a pressing that failed to load stays visible (with its Retry); loaded ones show when they match", () => {
  assert.equal(searchVisible(failed, "1577a"), true);
  assert.equal(searchVisible(loadedS(B), "1577a"), true);
  assert.equal(searchVisible(loadedS(B), "zzz"), false);
  assert.equal(searchVisible({ status: "loading" }, "1577a"), false);
  assert.equal(searchVisible(undefined, "1577a"), false);
});

test("runoutCounts tells not-tried, failed and loaded apart (a failure is not 'not checked yet')", () => {
  const states = new Map<number, RunoutState>([[1, loadedS(B)], [2, failed], [3, { status: "loading" }]]);
  assert.deepEqual(runoutCounts([1, 2, 3, 4, 5], states), { notTried: 2, failed: 1, loaded: 1 });
});

test("a row auto-opened by a search collapses on the first click, and stays collapsed", () => {
  const none = new Set<number>();
  assert.equal(isExpanded(1, none, none, loadedS(B), true), true, "auto-open while searching");
  const after = toggleExpanded(1, none, none, true);
  assert.equal(isExpanded(1, after.opened, after.collapsed, loadedS(B), true), false, "one click closes it");
  const again = toggleExpanded(1, after.opened, after.collapsed, false);
  assert.equal(isExpanded(1, again.opened, again.collapsed, loadedS(B), true), true);
  assert.equal(isExpanded(2, none, none, failed, true), true, "failed rows open while searching, to show Retry");
  assert.equal(isExpanded(1, none, none, loadedS(B), false), false, "closed by default without a search");
  assert.equal(isExpanded(1, new Set([1]), none, undefined, false), true);
});

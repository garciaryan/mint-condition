import assert from "node:assert/strict";
import { test } from "node:test";
import { coverageText, etaText, pasteSummary } from "../lib/collection/ui.ts";

test("coverageText omits zero parts after priced", () => {
  assert.equal(
    coverageText({ priced: 62, total: 70, toPick: 4, noPrice: 2, problems: 1 }),
    "62 of 70 priced · 4 to pick · 2 no price · 1 error",
  );
  assert.equal(coverageText({ priced: 3, total: 3, toPick: 0, noPrice: 0, problems: 0 }), "3 of 3 priced");
  assert.equal(coverageText({ priced: 0, total: 2, toPick: 0, noPrice: 0, problems: 2 }), "0 of 2 priced · 2 error");
});

test("etaText formats seconds and minutes", () => {
  assert.equal(etaText(5), "5 sec");
  assert.equal(etaText(59), "59 sec");
  assert.equal(etaText(120), "2 min");
  assert.equal(etaText(0), "1 sec");
});

test("pasteSummary lists skipped lines", () => {
  assert.equal(pasteSummary(23, []), "23 records");
  assert.equal(pasteSummary(1, [4]), "1 record, 1 line skipped: line 4");
  assert.equal(pasteSummary(5, [2, 3]), "5 records, 2 lines skipped: lines 2, 3");
  assert.equal(pasteSummary(5, [1, 2, 3, 4, 5, 6]), "5 records, 6 lines skipped: lines 1, 2, 3, 4, 5, …");
});

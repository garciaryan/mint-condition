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

import { createSerialQueue } from "../lib/collection/ui.ts";

test("createSerialQueue runs jobs one at a time, in order, and survives rejection", async () => {
  const enqueue = createSerialQueue();
  const log: string[] = [];
  let running = 0;
  let maxRunning = 0;
  const job = (name: string, ms: number, fail = false) => async () => {
    running++;
    maxRunning = Math.max(maxRunning, running);
    log.push(`start ${name}`);
    await new Promise((r) => setTimeout(r, ms));
    running--;
    log.push(`end ${name}`);
    if (fail) throw new Error(name);
    return name;
  };
  const results = await Promise.allSettled([enqueue(job("a", 30)), enqueue(job("b", 1, true)), enqueue(job("c", 1))]);
  assert.equal(maxRunning, 1);
  assert.deepEqual(log, ["start a", "end a", "start b", "end b", "start c", "end c"]);
  assert.deepEqual(results.map((r) => r.status), ["fulfilled", "rejected", "fulfilled"]);
});

import { STATUS_INFO } from "../lib/collection/ui.ts";
test("STATUS_INFO covers every item status with text", () => {
  for (const k of ["pending", "looking-up", "to-pick", "priced", "no-match", "no-price", "error"] as const) {
    assert.ok(STATUS_INFO[k].text.length > 0);
  }
  assert.equal(STATUS_INFO.priced.text, "Priced");
});

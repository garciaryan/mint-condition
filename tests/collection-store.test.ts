import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../lib/db.ts";
import {
  addItems, applyLookup, claimNextPending, countClaimable, countPending, createSession, deleteItem, deleteSession, getItem,
  getSession, listItems, listSessions, pickRelease, releaseClaim, repriceSession, resetWorking, retryItem, setItemPick,
  touchSession, updateItemFields, updateSession,
} from "../lib/collection/store.ts";
import type { Candidate } from "../lib/types.ts";

const cand = (id: number): Candidate => ({ id, title: `T${id}`, year: 1970, country: "US", label: "L", catno: "C", format: "LP", thumb: null });
const G = { record: "VG+", sleeve: "VG" } as const;
const setup = () => {
  const db = openDb(":memory:");
  const s = createSession(db, { name: "A", defaultRecord: "NM", defaultSleeve: "NM" }, 100);
  return { db, s };
};

test("sessions: create, get, update, list ordered by updatedAt", () => {
  const { db, s } = setup();
  assert.deepEqual(s, {
    id: s.id, name: "A", defaultRecord: "NM", defaultSleeve: "NM", createdAt: 100, updatedAt: 100,
    unverified: false, pickThreshold: null, bulkEach: null, lotOverhead: 0,
  });
  const b = createSession(db, { name: "B", defaultRecord: "VG", defaultSleeve: "VG" }, 200);
  assert.deepEqual(listSessions(db).map((x) => x.name), ["B", "A"]);
  const u = updateSession(db, s.id, { name: "A2", defaultRecord: "M" }, 300)!;
  assert.equal(u.name, "A2");
  assert.equal(u.defaultRecord, "M");
  assert.equal(u.defaultSleeve, "NM");
  assert.equal(u.updatedAt, 300);
  assert.deepEqual(listSessions(db).map((x) => x.name), ["A2", "B"]);
  touchSession(db, b.id, 400);
  assert.equal(getSession(db, b.id)!.updatedAt, 400);
  assert.equal(getSession(db, 999), null);
  assert.equal(updateSession(db, 999, { name: "x" }, 1), null);
  assert.equal(deleteSession(db, b.id), true);
  assert.equal(deleteSession(db, b.id), false);
});

test("addItems returns pending rows in order; listItems newest first", () => {
  const { db, s } = setup();
  const rows = addItems(db, s.id, [{ query: "A1", year: 1970 }, { query: "A2" }], G, 1000);
  assert.deepEqual(rows.map((r) => r.query), ["A1", "A2"]);
  assert.equal(rows[0].status, "pending");
  assert.equal(rows[0].year, 1970);
  assert.equal(rows[1].year, null);
  assert.equal(rows[0].record, "VG+");
  assert.equal(rows[0].sleeve, "VG");
  assert.equal(rows[0].release, null);
  assert.deepEqual(listItems(db, s.id).map((r) => r.query), ["A2", "A1"]);
  assert.equal(getItem(db, 999), null);
});

test("claimNextPending claims oldest first across lots", () => {
  const { db, s } = setup();
  const s2 = createSession(db, { name: "B", defaultRecord: "NM", defaultSleeve: "NM" }, 100);
  addItems(db, s2.id, [{ query: "B1" }], G, 10);
  addItems(db, s.id, [{ query: "A1" }, { query: "A2" }], G, 20);
  const got = [claimNextPending(db), claimNextPending(db), claimNextPending(db)].map((r) => r?.query);
  assert.deepEqual(got, ["B1", "A1", "A2"]);
  assert.equal(claimNextPending(db), null);
  assert.equal(listItems(db, s.id)[0].status, "working");
});

test("applyLookup writes the patch and keeps grades changed mid-lookup", () => {
  const { db, s } = setup();
  addItems(db, s.id, [{ query: "A1" }], G, 1);
  const w = claimNextPending(db)!;
  updateItemFields(db, w.id, { record: "NM" });
  const ok = applyLookup(db, w.id, {
    status: "priced", releaseId: 5, release: cand(5), suggestions: { NM: 10 },
    stats: { lowestPrice: 9, currency: "USD", numForSale: 3 }, pricedAt: 77,
  });
  assert.equal(ok, true);
  const r = getItem(db, w.id)!;
  assert.equal(r.record, "NM");
  assert.equal(r.sleeve, "VG");
  assert.equal(r.status, "priced");
  assert.equal(r.releaseId, 5);
  assert.deepEqual(r.release, cand(5));
  assert.deepEqual(r.suggestions, { NM: 10 });
  assert.equal(r.stats!.numForSale, 3);
  assert.equal(r.pricedAt, 77);
  assert.equal(r.error, null);
});

test("applyLookup returns false for deleted or non-working rows", () => {
  const { db, s } = setup();
  const [a, b] = addItems(db, s.id, [{ query: "A" }, { query: "B" }], G, 1);
  assert.equal(applyLookup(db, a.id, { status: "error", error: "x" }), false);
  claimNextPending(db);
  deleteItem(db, a.id);
  assert.equal(applyLookup(db, a.id, { status: "error", error: "x" }), false);
  assert.equal(getItem(db, a.id), null);
  assert.equal(getItem(db, b.id)!.status, "pending");
});

test("applyLookup stores candidates and error", () => {
  const { db, s } = setup();
  addItems(db, s.id, [{ query: "A" }], G, 1);
  const w = claimNextPending(db)!;
  applyLookup(db, w.id, { status: "to-pick", candidates: [cand(1), cand(2)] });
  assert.deepEqual(getItem(db, w.id)!.candidates, [cand(1), cand(2)]);
});

test("pickRelease", () => {
  const { db, s } = setup();
  const [a, b] = addItems(db, s.id, [{ query: "A" }, { query: "B" }], G, 1);
  claimNextPending(db);
  applyLookup(db, a.id, { status: "to-pick", candidates: [cand(1), cand(2)] });
  assert.equal(pickRelease(db, a.id, 3), "invalid");
  assert.equal(pickRelease(db, b.id, 1), "invalid");
  assert.equal(pickRelease(db, 999, 1), "not-found");
  const r = pickRelease(db, a.id, 2);
  assert.notEqual(typeof r, "string");
  const row = r as Exclude<typeof r, string>;
  assert.equal(row.status, "pending");
  assert.equal(row.releaseId, 2);
  assert.deepEqual(row.release, cand(2));
  assert.equal(row.candidates, null);
});

test("retryItem only from error/no-match", () => {
  const { db, s } = setup();
  const [a, b, c] = addItems(db, s.id, [{ query: "A" }, { query: "B" }, { query: "C" }], G, 1);
  claimNextPending(db); claimNextPending(db);
  applyLookup(db, a.id, { status: "error", error: "boom" });
  applyLookup(db, b.id, { status: "no-match" });
  assert.equal(retryItem(db, c.id), "invalid-state");
  assert.equal(retryItem(db, 999), "not-found");
  const ra = retryItem(db, a.id) as { status: string; error: string | null };
  assert.equal(ra.status, "pending");
  assert.equal(ra.error, null);
  assert.equal((retryItem(db, b.id) as { status: string }).status, "pending");
});

test("repriceSession moves only priced/no-price rows with a release, keeping suggestions", () => {
  const { db, s } = setup();
  const [a, b, c, d] = addItems(db, s.id, [{ query: "A" }, { query: "B" }, { query: "C" }, { query: "D" }], G, 1);
  for (let i = 0; i < 4; i++) claimNextPending(db);
  applyLookup(db, a.id, { status: "priced", releaseId: 1, release: cand(1), suggestions: { NM: 5 } });
  applyLookup(db, b.id, { status: "no-price", releaseId: 2, release: cand(2) });
  applyLookup(db, c.id, { status: "no-match" });
  applyLookup(db, d.id, { status: "priced" });
  assert.equal(repriceSession(db, s.id), 2);
  assert.equal(getItem(db, a.id)!.status, "pending");
  assert.deepEqual(getItem(db, a.id)!.suggestions, { NM: 5 });
  assert.equal(getItem(db, b.id)!.status, "pending");
  assert.equal(getItem(db, c.id)!.status, "no-match");
  assert.equal(getItem(db, d.id)!.status, "priced");
});

test("year change resets lookup columns; grade change does not", () => {
  const { db, s } = setup();
  addItems(db, s.id, [{ query: "A", year: 1970 }], G, 1);
  const w = claimNextPending(db)!;
  applyLookup(db, w.id, {
    status: "priced", releaseId: 5, release: cand(5), suggestions: { NM: 1 },
    stats: { lowestPrice: 1, currency: "USD", numForSale: 1 }, pricedAt: 9,
  });
  const g = updateItemFields(db, w.id, { sleeve: "M", year: 1970 })!;
  assert.equal(g.status, "priced");
  assert.equal(g.sleeve, "M");
  assert.equal(g.releaseId, 5);
  const y = updateItemFields(db, w.id, { year: 1971 })!;
  assert.equal(y.year, 1971);
  assert.equal(y.status, "pending");
  assert.equal(y.releaseId, null);
  assert.equal(y.release, null);
  assert.equal(y.candidates, null);
  assert.equal(y.suggestions, null);
  assert.equal(y.stats, null);
  assert.equal(y.pricedAt, null);
  assert.equal(y.error, null);
  assert.equal(updateItemFields(db, w.id, { year: null })!.year, null);
  assert.equal(updateItemFields(db, 999, { record: "G" }), null);
});

test("resetWorking and countPending", () => {
  const { db, s } = setup();
  addItems(db, s.id, [{ query: "A" }, { query: "B" }, { query: "C" }], G, 1);
  claimNextPending(db);
  assert.equal(countPending(db), 3);
  const w = claimNextPending(db)!;
  applyLookup(db, w.id, { status: "no-match" });
  assert.equal(countPending(db), 2);
  assert.equal(resetWorking(db), 1);
  assert.equal(countPending(db), 2);
  assert.equal(listItems(db, s.id).filter((r) => r.status === "working").length, 0);
});

test("countClaimable counts only pending rows", () => {
  const { db, s } = setup();
  addItems(db, s.id, [{ query: "A" }, { query: "B" }, { query: "C" }], G, 1);
  assert.equal(countClaimable(db), 3);
  claimNextPending(db);
  assert.equal(countClaimable(db), 2);
  assert.equal(countPending(db), 3);
  const w = claimNextPending(db)!;
  applyLookup(db, w.id, { status: "no-match" });
  assert.equal(countClaimable(db), 1);
  claimNextPending(db);
  assert.equal(countClaimable(db), 0);
  assert.equal(countPending(db), 2);
});

test("deleteSession cascades to items", () => {
  const { db, s } = setup();
  const [a] = addItems(db, s.id, [{ query: "A" }], G, 1);
  deleteSession(db, s.id);
  assert.equal(getItem(db, a.id), null);
});

test("applyLookup leaves omitted columns untouched and clears explicit nulls", () => {
  const { db, s } = setup();
  addItems(db, s.id, [{ query: "A" }], G, 1);
  const w = claimNextPending(db)!;
  applyLookup(db, w.id, {
    status: "priced", releaseId: 5, release: cand(5), suggestions: { NM: 10 },
    stats: { lowestPrice: 9, currency: "USD", numForSale: 3 }, pricedAt: 77,
  });
  repriceSession(db, s.id);
  claimNextPending(db);
  assert.equal(applyLookup(db, w.id, { status: "error", error: "x" }), true);
  const r = getItem(db, w.id)!;
  assert.equal(r.status, "error");
  assert.equal(r.error, "x");
  assert.equal(r.releaseId, 5);
  assert.deepEqual(r.release, cand(5));
  assert.deepEqual(r.suggestions, { NM: 10 });
  assert.equal(r.stats!.numForSale, 3);
  assert.equal(r.pricedAt, 77);
  retryItem(db, w.id);
  claimNextPending(db);
  applyLookup(db, w.id, { status: "no-match", releaseId: null, release: null });
  const c = getItem(db, w.id)!;
  assert.equal(c.releaseId, null);
  assert.equal(c.release, null);
  assert.deepEqual(c.suggestions, { NM: 10 });
});

test("listItems reports candidate_count without parsing candidates; releaseClaim returns a working row", () => {
  const db = openDb(":memory:");
  const s = createSession(db, { name: "L", defaultRecord: "NM", defaultSleeve: "NM" }, 1);
  const [a, b] = addItems(db, s.id, [{ query: "A" }, { query: "B" }], { record: "NM", sleeve: "NM" }, 1);
  db.prepare("UPDATE items SET status = 'to-pick', candidates_json = ? WHERE id = ?").run(JSON.stringify([cand(1), cand(2), cand(3)]), a.id);
  const rows = listItems(db, s.id);
  const ra = rows.find((r) => r.id === a.id)!;
  assert.equal(ra.candidates, null);
  assert.equal(ra.candidateCount, 3);
  assert.equal(rows.find((r) => r.id === b.id)!.candidateCount, 0);
  assert.deepEqual(getItem(db, a.id)!.candidates?.length, 3);

  db.prepare("UPDATE items SET status = 'working' WHERE id = ?").run(b.id);
  releaseClaim(db, b.id);
  assert.equal(getItem(db, b.id)!.status, "pending");
  releaseClaim(db, a.id);
  assert.equal(getItem(db, a.id)!.status, "to-pick");
});

test("updateSession saves offer inputs and keeps others", () => {
  const { db, s } = setup();
  updateSession(db, s.id, { unverified: true, pickThreshold: 20, bulkEach: 1, lotOverhead: 25 }, 200);
  const u = updateSession(db, s.id, { name: "X" }, 300)!;
  assert.deepEqual([u.name, u.unverified, u.pickThreshold, u.bulkEach, u.lotOverhead], ["X", true, 20, 1, 25]);
  const r = updateSession(db, s.id, { pickThreshold: null }, 400)!;
  assert.deepEqual([r.unverified, r.pickThreshold, r.bulkEach, r.lotOverhead], [true, null, 1, 25]);
});

test("setItemPick pins and survives re-price and lookup", () => {
  const { db, s } = setup();
  const [it] = addItems(db, s.id, [{ query: "A" }], G, 1);
  assert.equal(it.pick, null);
  assert.equal(setItemPick(db, it.id, true)!.pick, true);
  claimNextPending(db);
  applyLookup(db, it.id, { status: "priced", releaseId: 5, release: cand(5), suggestions: { "VG+": 20 }, stats: null, pricedAt: 1 });
  assert.equal(repriceSession(db, s.id), 1);
  claimNextPending(db);
  applyLookup(db, it.id, { status: "priced", suggestions: { "VG+": 21 }, pricedAt: 2 });
  assert.equal(getItem(db, it.id)!.pick, true);
  assert.equal(listItems(db, s.id)[0].pick, true);
  assert.equal(setItemPick(db, it.id, false)!.pick, false);
  assert.equal(setItemPick(db, 9999, true), null);
});

test("reprice and retry set refresh; applyLookup clears it", () => {
  const { db, s } = setup();
  const [a, b] = addItems(db, s.id, [{ query: "A" }, { query: "B" }], G, 1);
  assert.equal(getItem(db, a.id)!.refresh, false);
  claimNextPending(db);
  applyLookup(db, a.id, { status: "priced", releaseId: 1, suggestions: { NM: 1 }, stats: null, pricedAt: 1 });
  assert.equal(repriceSession(db, s.id), 1);
  assert.equal(getItem(db, a.id)!.refresh, true);
  claimNextPending(db);
  applyLookup(db, a.id, { status: "priced", pricedAt: 2 });
  assert.equal(getItem(db, a.id)!.refresh, false);
  claimNextPending(db);
  applyLookup(db, b.id, { status: "error", error: "boom" });
  assert.equal((retryItem(db, b.id) as { refresh: boolean }).refresh, true);
});

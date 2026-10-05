// Data layer for lots (sessions) and their records (items). Plain functions over node:sqlite.
import type { DatabaseSync } from "node:sqlite";
import type { Grade } from "../types.ts";
import type { ItemRow, ItemStatus, LookupPatch, NewLine, SessionPatch, SessionRow } from "./types.ts";

type Row = Record<string, unknown>;

const toSession = (r: Row): SessionRow => ({
  id: r.id as number,
  name: r.name as string,
  defaultRecord: r.default_record as Grade,
  defaultSleeve: r.default_sleeve as Grade,
  createdAt: r.created_at as number,
  updatedAt: r.updated_at as number,
  unverified: r.unverified === 1,
  pickThreshold: (r.pick_threshold as number | null) ?? null,
  bulkEach: (r.bulk_each as number | null) ?? null,
  lotOverhead: r.lot_overhead as number,
});

const parse = <T>(v: unknown): T | null => (typeof v === "string" ? (JSON.parse(v) as T) : null);
const json = (v: unknown): string | null => (v == null ? null : JSON.stringify(v));

const toItem = (r: Row, lite = false): ItemRow => ({
  id: r.id as number,
  sessionId: r.session_id as number,
  query: r.query as string,
  year: (r.year as number | null) ?? null,
  record: r.record_grade as Grade,
  sleeve: r.sleeve_grade as Grade,
  status: r.status as ItemStatus,
  releaseId: (r.release_id as number | null) ?? null,
  release: parse(r.release_json),
  candidates: lite ? null : parse(r.candidates_json),
  candidateCount: (r.candidate_count as number | null) ?? undefined,
  suggestions: parse(r.suggestions_json),
  stats: parse(r.stats_json),
  pricedAt: (r.priced_at as number | null) ?? null,
  error: (r.error as string | null) ?? null,
  createdAt: r.created_at as number,
  pick: r.pick == null ? null : r.pick === 1,
  refresh: r.refresh === 1,
});

// ---- sessions ----

export function getSession(db: DatabaseSync, id: number): SessionRow | null {
  const r = db.prepare("SELECT * FROM sessions WHERE id = ?").get(id);
  return r ? toSession(r) : null;
}

export function createSession(
  db: DatabaseSync,
  input: { name: string; defaultRecord: Grade; defaultSleeve: Grade },
  now: number,
): SessionRow {
  const res = db
    .prepare("INSERT INTO sessions (name, default_record, default_sleeve, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
    .run(input.name, input.defaultRecord, input.defaultSleeve, now, now);
  return getSession(db, Number(res.lastInsertRowid))!;
}

export function listSessions(db: DatabaseSync): SessionRow[] {
  return db.prepare("SELECT * FROM sessions ORDER BY updated_at DESC, id DESC").all().map(toSession);
}

export function updateSession(db: DatabaseSync, id: number, patch: SessionPatch, now: number): SessionRow | null {
  const cur = getSession(db, id);
  if (!cur) return null;
  // undefined = leave unchanged; an explicit null (threshold, bulk) resets to the settings default.
  const v = <K extends keyof SessionPatch & keyof SessionRow>(k: K) => (patch[k] !== undefined ? patch[k] : cur[k]);
  db.prepare(
    `UPDATE sessions SET name = ?, default_record = ?, default_sleeve = ?, unverified = ?, pick_threshold = ?,
       bulk_each = ?, lot_overhead = ?, updated_at = ? WHERE id = ?`,
  ).run(
    v("name")!,
    v("defaultRecord")!,
    v("defaultSleeve")!,
    v("unverified") ? 1 : 0,
    v("pickThreshold") ?? null,
    v("bulkEach") ?? null,
    v("lotOverhead")!,
    now,
    id,
  );
  return getSession(db, id);
}

export function deleteSession(db: DatabaseSync, id: number): boolean {
  return Number(db.prepare("DELETE FROM sessions WHERE id = ?").run(id).changes) > 0;
}

export function touchSession(db: DatabaseSync, id: number, now: number): void {
  db.prepare("UPDATE sessions SET updated_at = ? WHERE id = ?").run(now, id);
}

// ---- items ----

export function getItem(db: DatabaseSync, id: number): ItemRow | null {
  const r = db.prepare("SELECT * FROM items WHERE id = ?").get(id);
  return r ? toItem(r) : null;
}

// List reads skip the (large) candidate JSON and carry only its length.
const LIST_COLUMNS = `id, session_id, query, year, record_grade, sleeve_grade, status, release_id, release_json,
  suggestions_json, stats_json, priced_at, error, created_at, pick,
  CASE WHEN candidates_json IS NULL THEN 0 ELSE json_array_length(candidates_json) END AS candidate_count`;

export function listItems(db: DatabaseSync, sessionId: number): ItemRow[] {
  return db
    .prepare(`SELECT ${LIST_COLUMNS} FROM items WHERE session_id = ? ORDER BY created_at DESC, id DESC`)
    .all(sessionId)
    .map((r) => toItem(r, true));
}

export function addItems(
  db: DatabaseSync,
  sessionId: number,
  lines: NewLine[],
  grades: { record: Grade; sleeve: Grade },
  now: number,
): ItemRow[] {
  const ins = db.prepare(
    "INSERT INTO items (session_id, query, year, record_grade, sleeve_grade, status, created_at) VALUES (?, ?, ?, ?, ?, 'pending', ?)",
  );
  const ids: number[] = [];
  db.exec("BEGIN");
  try {
    for (const l of lines) {
      ids.push(Number(ins.run(sessionId, l.query, l.year ?? null, grades.record, grades.sleeve, now).lastInsertRowid));
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return ids.map((id) => getItem(db, id)!);
}

export function updateItemFields(
  db: DatabaseSync,
  id: number,
  patch: { record?: Grade; sleeve?: Grade; year?: number | null },
): ItemRow | null {
  const cur = getItem(db, id);
  if (!cur) return null;
  db.prepare("UPDATE items SET record_grade = ?, sleeve_grade = ? WHERE id = ?").run(
    patch.record ?? cur.record,
    patch.sleeve ?? cur.sleeve,
    id,
  );
  if (patch.year !== undefined && patch.year !== cur.year) {
    db.prepare(
      `UPDATE items SET year = ?, status = 'pending', release_id = NULL, release_json = NULL, candidates_json = NULL,
         suggestions_json = NULL, stats_json = NULL, priced_at = NULL, error = NULL WHERE id = ?`,
    ).run(patch.year, id);
  }
  return getItem(db, id);
}

export function pickRelease(db: DatabaseSync, id: number, releaseId: number): ItemRow | "not-found" | "invalid" {
  const cur = getItem(db, id);
  if (!cur) return "not-found";
  if (cur.status !== "to-pick") return "invalid";
  const chosen = cur.candidates?.find((c) => c.id === releaseId);
  if (!chosen) return "invalid";
  db.prepare(
    "UPDATE items SET release_id = ?, release_json = ?, candidates_json = NULL, status = 'pending' WHERE id = ? AND status = 'to-pick'",
  ).run(chosen.id, JSON.stringify(chosen), id);
  return getItem(db, id)!;
}

export function setItemPick(db: DatabaseSync, id: number, pick: boolean): ItemRow | null {
  const res = db.prepare("UPDATE items SET pick = ? WHERE id = ?").run(pick ? 1 : 0, id);
  return Number(res.changes) > 0 ? getItem(db, id) : null;
}

export function retryItem(db: DatabaseSync, id: number): ItemRow | "not-found" | "invalid-state" {
  const cur = getItem(db, id);
  if (!cur) return "not-found";
  if (cur.status !== "error" && cur.status !== "no-match") return "invalid-state";
  db.prepare("UPDATE items SET status = 'pending', error = NULL, refresh = 1 WHERE id = ?").run(id);
  return getItem(db, id)!;
}

export function repriceSession(db: DatabaseSync, sessionId: number): number {
  const res = db
    .prepare(
      "UPDATE items SET status = 'pending', refresh = 1 WHERE session_id = ? AND status IN ('priced','no-price') AND release_id IS NOT NULL",
    )
    .run(sessionId);
  return Number(res.changes);
}

export function deleteItem(db: DatabaseSync, id: number): boolean {
  return Number(db.prepare("DELETE FROM items WHERE id = ?").run(id).changes) > 0;
}

// ---- worker support ----

export function claimNextPending(db: DatabaseSync): ItemRow | null {
  const r = db
    .prepare(
      `UPDATE items SET status = 'working'
       WHERE id = (SELECT id FROM items WHERE status = 'pending' ORDER BY created_at, id LIMIT 1)
       RETURNING *`,
    )
    .get();
  return r ? toItem(r) : null;
}

// Writes only lookup columns, so grades/year/query edited mid-lookup survive. Keys absent from the patch are left
// untouched; an explicit null clears.
const LOOKUP_COLUMNS = [
  ["releaseId", "release_id", (v: unknown) => v],
  ["release", "release_json", json],
  ["candidates", "candidates_json", json],
  ["suggestions", "suggestions_json", json],
  ["stats", "stats_json", json],
  ["pricedAt", "priced_at", (v: unknown) => v],
  ["error", "error", (v: unknown) => v],
] as const;

export function applyLookup(db: DatabaseSync, id: number, patch: LookupPatch): boolean {
  const sets = ["status = ?", "refresh = 0"];
  const values: (string | number | null)[] = [patch.status];
  for (const [key, col, enc] of LOOKUP_COLUMNS) {
    if (key in patch) {
      sets.push(`${col} = ?`);
      values.push((enc(patch[key]) ?? null) as string | number | null);
    }
  }
  const res = db.prepare(`UPDATE items SET ${sets.join(", ")} WHERE id = ? AND status = 'working'`).run(...values, id);
  return Number(res.changes) > 0;
}

export function releaseClaim(db: DatabaseSync, id: number): void {
  db.prepare("UPDATE items SET status = 'pending' WHERE id = ? AND status = 'working'").run(id);
}

export function resetWorking(db: DatabaseSync): number {
  return Number(db.prepare("UPDATE items SET status = 'pending' WHERE status = 'working'").run().changes);
}

export function countPending(db: DatabaseSync): number {
  const r = db.prepare("SELECT count(*) AS n FROM items WHERE status IN ('pending','working')").get() as { n: number };
  return r.n;
}

/** Rows a worker loop can actually claim (pending only; `working` rows belong to a loop). */
export function countClaimable(db: DatabaseSync): number {
  const r = db.prepare("SELECT count(*) AS n FROM items WHERE status = 'pending'").get() as { n: number };
  return r.n;
}

// The shop's Discogs OAuth connection (one row, id 1) and the sign-in in progress. Server-side only.
// Cached Discogs answers belong to one seller account, so saving or clearing a connection empties discogs_cache.
import type { DatabaseSync } from "node:sqlite";

export type Connection = { token: string; secret: string; username: string; connectedAt: number };

/** A pending sign-in older than this is refused. */
export const PENDING_MAX_MS = 10 * 60 * 1000;

type Row = { token: string | null; secret: string | null; username: string | null; connected_at: number | null };

export function getConnection(db: DatabaseSync): Connection | null {
  const r = db.prepare("SELECT token, secret, username, connected_at FROM discogs_auth WHERE id = 1").get() as Row | undefined;
  if (!r || r.token === null || r.secret === null) return null;
  return { token: r.token, secret: r.secret, username: r.username ?? "", connectedAt: r.connected_at ?? 0 };
}

export function saveConnection(db: DatabaseSync, c: Connection): void {
  db.prepare(
    `INSERT INTO discogs_auth (id, token, secret, username, connected_at) VALUES (1, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET token = excluded.token, secret = excluded.secret, username = excluded.username,
       connected_at = excluded.connected_at, pending_token = NULL, pending_secret = NULL, pending_at = NULL`,
  ).run(c.token, c.secret, c.username, c.connectedAt);
  db.exec("DELETE FROM discogs_cache");
}

export function clearConnection(db: DatabaseSync): void {
  db.prepare("UPDATE discogs_auth SET token = NULL, secret = NULL, username = NULL, connected_at = NULL WHERE id = 1").run();
  db.exec("DELETE FROM discogs_cache");
}

export function savePending(db: DatabaseSync, token: string, secret: string, at: number): void {
  db.prepare(
    `INSERT INTO discogs_auth (id, pending_token, pending_secret, pending_at) VALUES (1, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET pending_token = excluded.pending_token, pending_secret = excluded.pending_secret,
       pending_at = excluded.pending_at`,
  ).run(token, secret, at);
}

/** The secret for a matching, fresh request token. Always clears the pending sign-in, so each is used once. */
export function takePending(db: DatabaseSync, token: string, now: number): { secret: string } | null {
  const r = db.prepare("SELECT pending_token, pending_secret, pending_at FROM discogs_auth WHERE id = 1").get() as
    | { pending_token: string | null; pending_secret: string | null; pending_at: number | null }
    | undefined;
  db.prepare("UPDATE discogs_auth SET pending_token = NULL, pending_secret = NULL, pending_at = NULL WHERE id = 1").run();
  if (!r || r.pending_token === null || r.pending_secret === null || r.pending_at === null) return null;
  if (r.pending_token !== token || now - r.pending_at > PENDING_MAX_MS) return null;
  return { secret: r.pending_secret };
}

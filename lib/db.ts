// SQLite handle (node:sqlite). Server-side only.
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { migrate, migrations } from "./migrations.ts";

export function openDb(file: string): DatabaseSync {
  mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");
  migrate(db, migrations);
  return db;
}

// One handle per server process; kept on globalThis to survive dev reloads.
const g = globalThis as typeof globalThis & { __mintDb?: DatabaseSync };
export function getDb(): DatabaseSync {
  g.__mintDb ??= openDb(path.join(process.env.DATA_DIR ?? "./data", "mint.db"));
  return g.__mintDb;
}

/** User-facing message when the database can't be opened (e.g. the Fly volume isn't mounted). */
export function dbUnavailable(e: unknown): string {
  return `The database is unavailable: ${e instanceof Error ? e.message : String(e)}`;
}

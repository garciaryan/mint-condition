// Ordered schema steps. Append only; never edit a shipped step. user_version records how many have run.
import type { DatabaseSync } from "node:sqlite";

export const migrations: string[] = [
  `CREATE TABLE sessions (
  id              INTEGER PRIMARY KEY,
  name            TEXT    NOT NULL,
  default_record  TEXT    NOT NULL,
  default_sleeve  TEXT    NOT NULL,
  created_at      INTEGER NOT NULL,   -- ms epoch
  updated_at      INTEGER NOT NULL
);
CREATE TABLE items (
  id               INTEGER PRIMARY KEY,
  session_id       INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  query            TEXT    NOT NULL,  -- catno or barcode as entered (trimmed, <= 64 chars)
  year             INTEGER,           -- optional search year
  record_grade     TEXT    NOT NULL,
  sleeve_grade     TEXT    NOT NULL,
  status           TEXT    NOT NULL CHECK (status IN ('pending','working','to-pick','priced','no-match','no-price','error')),
  release_id       INTEGER,
  release_json     TEXT,              -- Candidate of the chosen pressing
  candidates_json  TEXT,              -- Candidate[] when several matched
  suggestions_json TEXT,              -- PriceSuggestions (all grades)
  stats_json       TEXT,              -- MarketplaceStats
  priced_at        INTEGER,
  error            TEXT,              -- short message for status 'error'
  created_at       INTEGER NOT NULL
);
CREATE INDEX items_session ON items(session_id, created_at);
CREATE INDEX items_status  ON items(status, created_at);`,
  `ALTER TABLE sessions ADD COLUMN unverified     INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN pick_threshold REAL;      -- null = settings default
ALTER TABLE sessions ADD COLUMN bulk_each      REAL;      -- null = settings default
ALTER TABLE sessions ADD COLUMN lot_overhead   REAL NOT NULL DEFAULT 0;
ALTER TABLE items    ADD COLUMN pick           INTEGER;   -- null = automatic, 1 = pick, 0 = not a pick`,
  `CREATE TABLE settings (
  id         INTEGER PRIMARY KEY CHECK (id = 1),  -- at most one row
  json       TEXT    NOT NULL,                     -- full Settings object as saved
  updated_at INTEGER NOT NULL                      -- ms epoch
);`,
  `CREATE TABLE discogs_cache (
  key        TEXT    PRIMARY KEY,   -- "search:<query>|<year or ->", "suggestions:<releaseId>", "stats:<releaseId>"
  json       TEXT    NOT NULL,      -- the method's result, including empty search and null suggestions
  fetched_at INTEGER NOT NULL       -- ms epoch, when Discogs answered
);
ALTER TABLE items ADD COLUMN refresh INTEGER NOT NULL DEFAULT 0;  -- 1 = the next lookup for this row skips the cache`,
  `ALTER TABLE items ADD COLUMN notes TEXT NOT NULL DEFAULT '';  -- public listing comment; '' = none`,
  `ALTER TABLE sessions ADD COLUMN skip_slow INTEGER NOT NULL DEFAULT 0;  -- 1 = automatic picks leave out slow sellers`,
  `CREATE TABLE discogs_auth (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  token TEXT, secret TEXT, username TEXT, connected_at INTEGER,   -- the shop's OAuth access; token NULL = not connected
  pending_token TEXT, pending_secret TEXT, pending_at INTEGER     -- a sign-in in progress (request token), ms epoch
);`,
];

export function migrate(db: DatabaseSync, steps: string[]): number {
  const row = db.prepare("pragma user_version").get() as { user_version: number };
  let version = row.user_version;
  for (let i = version; i < steps.length; i++) {
    db.exec("BEGIN");
    try {
      db.exec(steps[i]);
      db.exec(`PRAGMA user_version = ${i + 1}`);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
    version = i + 1;
  }
  return version;
}

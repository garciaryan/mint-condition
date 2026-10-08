import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { openDb } from "../lib/db.ts";
import { migrate, migrations } from "../lib/migrations.ts";
import {
  PENDING_MAX_MS, clearConnection, getConnection, saveConnection, savePending, takePending,
} from "../lib/discogs-auth-store.ts";

const conn = { token: "t", secret: "s", username: "shop", connectedAt: 1000 };
const cacheRows = (db: DatabaseSync) => (db.prepare("select count(*) as n from discogs_cache").get() as { n: number }).n;
const seedCache = (db: DatabaseSync) => {
  db.exec("insert into discogs_cache (key,json,fetched_at) values ('a','1',1),('b','2',2)");
};

test("migration 7 creates discogs_auth and sets user_version 7", () => {
  const db = openDb(":memory:");
  assert.equal((db.prepare("pragma user_version").get() as { user_version: number }).user_version, 7);
  assert.ok(db.prepare("select name from sqlite_master where name='discogs_auth'").get());
});

test("a version-6 database migrates to 7 keeping its rows", () => {
  const db = new DatabaseSync(":memory:");
  migrate(db, migrations.slice(0, 6));
  db.exec("insert into sessions (id,name,default_record,default_sleeve,created_at,updated_at) values (1,'L','NM','NM',1,1)");
  assert.equal(migrate(db, migrations), 7);
  assert.equal((db.prepare("select count(*) as n from sessions").get() as { n: number }).n, 1);
  assert.equal(getConnection(db), null);
});

test("getConnection is null on a fresh db; save then get round-trips; clear removes it", () => {
  const db = openDb(":memory:");
  assert.equal(getConnection(db), null);
  saveConnection(db, conn);
  assert.deepEqual(getConnection(db), conn);
  saveConnection(db, { ...conn, username: "other" });
  assert.equal(getConnection(db)?.username, "other");
  clearConnection(db);
  assert.equal(getConnection(db), null);
});

test("takePending returns the secret once, then null", () => {
  const db = openDb(":memory:");
  savePending(db, "rt", "rs", 5000);
  assert.deepEqual(takePending(db, "rt", 6000), { secret: "rs" });
  assert.equal(takePending(db, "rt", 6000), null);
});

test("a wrong token returns null and clears the pending sign-in", () => {
  const db = openDb(":memory:");
  savePending(db, "rt", "rs", 5000);
  assert.equal(takePending(db, "nope", 6000), null);
  assert.equal(takePending(db, "rt", 6000), null);
});

test("an expired pending sign-in returns null; the limit itself is still valid", () => {
  const db = openDb(":memory:");
  savePending(db, "rt", "rs", 5000);
  assert.equal(takePending(db, "rt", 5000 + PENDING_MAX_MS + 1), null);
  savePending(db, "rt", "rs", 5000);
  assert.deepEqual(takePending(db, "rt", 5000 + PENDING_MAX_MS), { secret: "rs" });
});

test("a second savePending replaces the first", () => {
  const db = openDb(":memory:");
  savePending(db, "one", "s1", 1);
  savePending(db, "two", "s2", 2);
  assert.equal(takePending(db, "one", 3), null);
  savePending(db, "one", "s1", 1);
  savePending(db, "two", "s2", 2);
  assert.deepEqual(takePending(db, "two", 3), { secret: "s2" });
});

test("saveConnection clears pending and does not need a prior row", () => {
  const db = openDb(":memory:");
  savePending(db, "rt", "rs", 1);
  saveConnection(db, conn);
  assert.equal(takePending(db, "rt", 2), null);
  assert.deepEqual(getConnection(db), conn);
});

test("savePending keeps an existing connection", () => {
  const db = openDb(":memory:");
  saveConnection(db, conn);
  savePending(db, "rt", "rs", 1);
  assert.deepEqual(getConnection(db), conn);
});

test("saveConnection and clearConnection each delete every discogs_cache row", () => {
  const db = openDb(":memory:");
  seedCache(db);
  saveConnection(db, conn);
  assert.equal(cacheRows(db), 0);
  seedCache(db);
  clearConnection(db);
  assert.equal(cacheRows(db), 0);
});

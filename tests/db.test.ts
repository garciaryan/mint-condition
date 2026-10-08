import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { migrate, migrations } from "../lib/migrations.ts";
import { openDb } from "../lib/db.ts";

const version = (db: DatabaseSync) => (db.prepare("pragma user_version").get() as { user_version: number }).user_version;
const count = (db: DatabaseSync) => (db.prepare("select count(*) as n from a").get() as { n: number }).n;

test("migrate applies steps in order and sets user_version", () => {
  const db = new DatabaseSync(":memory:");
  assert.equal(migrate(db, ["create table a(x)", "insert into a values (1)"]), 2);
  assert.equal(count(db), 1);
});

test("migrate is idempotent", () => {
  const db = new DatabaseSync(":memory:");
  const steps = ["create table a(x)", "insert into a values (1)"];
  migrate(db, steps);
  assert.equal(migrate(db, steps), 2);
  assert.equal(count(db), 1);
});

test("a failing step rolls back and leaves user_version unchanged", () => {
  const db = new DatabaseSync(":memory:");
  assert.throws(() => migrate(db, ["create table a(x)", "insert into a values (1); insert into nope values (1)"]));
  assert.equal(version(db), 1);
  assert.equal(count(db), 0);
});

test("openDb creates the directory and enables WAL and foreign keys", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "mint-"));
  const db = openDb(path.join(dir, "nested", "mint.db"));
  assert.equal((db.prepare("pragma journal_mode").get() as { journal_mode: string }).journal_mode, "wal");
  assert.equal((db.prepare("pragma foreign_keys").get() as { foreign_keys: number }).foreign_keys, 1);
  db.close();
});

test("migration 1 creates sessions, items, indexes and cascades deletes", () => {
  const db = openDb(":memory:");
  assert.equal(version(db), migrations.length);
  const names = (type: string) =>
    (db.prepare("select name from sqlite_master where type = ?").all(type) as { name: string }[]).map((r) => r.name);
  const tables = names("table");
  assert.ok(tables.includes("sessions") && tables.includes("items"));
  const indexes = names("index");
  assert.ok(indexes.includes("items_session") && indexes.includes("items_status"));
  db.exec("insert into sessions (id,name,default_record,default_sleeve,created_at,updated_at) values (1,'L','NM','NM',1,1)");
  db.exec("insert into items (session_id,query,record_grade,sleeve_grade,status,created_at) values (1,'x','NM','NM','pending',1)");
  db.exec("delete from sessions where id = 1");
  assert.equal((db.prepare("select count(*) as n from items").get() as { n: number }).n, 0);
});

test("migration 2 adds offer columns to a version-1 database", () => {
  const db = new DatabaseSync(":memory:");
  migrate(db, [migrations[0]]);
  db.exec("insert into sessions (id,name,default_record,default_sleeve,created_at,updated_at) values (1,'L','NM','NM',1,1)");
  db.exec("insert into items (session_id,query,record_grade,sleeve_grade,status,created_at) values (1,'x','NM','NM','pending',1)");
  assert.equal(migrate(db, migrations.slice(0, 2)), 2);
  assert.deepEqual({ ...(db.prepare("select unverified, pick_threshold, bulk_each, lot_overhead from sessions").get() as object) },
    { unverified: 0, pick_threshold: null, bulk_each: null, lot_overhead: 0 });
  assert.deepEqual({ ...(db.prepare("select pick from items").get() as object) }, { pick: null });
});

test("migration 3 adds a one-row settings table to a version-2 database", () => {
  const db = new DatabaseSync(":memory:");
  migrate(db, migrations.slice(0, 2));
  assert.equal(migrate(db, migrations.slice(0, 3)), 3);
  db.exec("insert into settings (id, json, updated_at) values (1, '{}', 1)");
  assert.throws(() => db.exec("insert into settings (id, json, updated_at) values (2, '{}', 1)"), /CHECK/);
});

test("migration 4 adds discogs_cache and items.refresh to a version-3 database", () => {
  const db = new DatabaseSync(":memory:");
  migrate(db, migrations.slice(0, 3));
  db.exec("insert into sessions (id,name,default_record,default_sleeve,created_at,updated_at) values (1,'L','NM','NM',1,1)");
  db.exec("insert into items (session_id,query,record_grade,sleeve_grade,status,created_at) values (1,'x','NM','NM','pending',1)");
  assert.equal(migrate(db, migrations.slice(0, 4)), 4);
  assert.deepEqual({ ...(db.prepare("select refresh from items").get() as object) }, { refresh: 0 });
  db.exec("insert into discogs_cache (key, json, fetched_at) values ('k', '1', 1)");
});

test("migration 5 adds items.notes to a version-4 database", () => {
  const db = new DatabaseSync(":memory:");
  migrate(db, migrations.slice(0, 4));
  db.exec("insert into sessions (id,name,default_record,default_sleeve,created_at,updated_at) values (1,'L','NM','NM',1,1)");
  db.exec("insert into items (session_id,query,record_grade,sleeve_grade,status,created_at) values (1,'x','NM','NM','pending',1)");
  assert.equal(migrate(db, migrations.slice(0, 5)), 5);
  assert.deepEqual({ ...(db.prepare("select notes from items").get() as object) }, { notes: "" });
});

test("migration 6 adds sessions.skip_slow to a version-5 database", () => {
  const db = new DatabaseSync(":memory:");
  migrate(db, migrations.slice(0, 5));
  db.exec("insert into sessions (id,name,default_record,default_sleeve,created_at,updated_at) values (1,'L','NM','NM',1,1)");
  assert.equal(migrate(db, migrations.slice(0, 6)), 6);
  assert.deepEqual({ ...(db.prepare("select skip_slow from sessions").get() as object) }, { skip_slow: 0 });
});

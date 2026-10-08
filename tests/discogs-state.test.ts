import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { discogsState } from "../lib/discogs-state.ts";
import { saveConnection } from "../lib/discogs-auth-store.ts";
import { migrate, migrations } from "../lib/migrations.ts";

const base = { DISCOGS_USER_AGENT: "App/1.0", DISCOGS_CONSUMER_KEY: "k", DISCOGS_CONSUMER_SECRET: "s" };
function mem() {
  const db = new DatabaseSync(":memory:");
  migrate(db, migrations);
  return db;
}

test("token mode", () => {
  assert.equal(discogsState({ ...base, DISCOGS_TOKEN: "t" }, mem).state, "token");
});
test("not connected, then connected with username only", () => {
  const db = mem();
  assert.equal(discogsState(base, () => db).state, "not-connected");
  saveConnection(db, { token: "t", secret: "sec", username: "bob", connectedAt: 5 });
  const s = discogsState(base, () => db);
  assert.deepEqual(s, { state: "connected", username: "bob", connectedAt: 5 });
});
test("setup when consumer vars are missing", () => {
  assert.equal(discogsState({ DISCOGS_USER_AGENT: "x" }, mem).state, "setup");
});
test("a database error does not throw", () => {
  const boom = () => {
    throw new Error("db");
  };
  assert.equal(discogsState(base, boom).state, "not-connected");
  assert.equal(discogsState({ DISCOGS_USER_AGENT: "x" }, boom).state, "setup");
});

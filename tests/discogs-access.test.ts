import { test } from "node:test";
import assert from "node:assert/strict";
import { discogsAccess, setupMissing } from "../lib/discogs-access.ts";

const conn = { token: "t", secret: "s", username: "bob", connectedAt: 1 };
const UA = { DISCOGS_USER_AGENT: "App/1.0" };
const pair = { DISCOGS_CONSUMER_KEY: "ck", DISCOGS_CONSUMER_SECRET: "cs" };

test("token wins, even with a connection", () => {
  assert.deepEqual(discogsAccess({ ...UA, ...pair, DISCOGS_TOKEN: " tok " }, conn), { kind: "token", token: "tok" });
});
test("consumer pair and connection give oauth", () => {
  assert.deepEqual(discogsAccess({ ...UA, ...pair }, conn), {
    kind: "oauth", consumerKey: "ck", consumerSecret: "cs", token: "t", secret: "s", username: "bob",
  });
});
test("consumer pair without a connection is not-connected", () => {
  assert.deepEqual(discogsAccess({ ...UA, ...pair }, null), { kind: "none", reason: "not-connected" });
});
test("one consumer var, or nothing, is setup", () => {
  assert.deepEqual(discogsAccess({ ...UA, DISCOGS_CONSUMER_KEY: "ck" }, conn), { kind: "none", reason: "setup" });
  assert.deepEqual(discogsAccess({ ...UA }, null), { kind: "none", reason: "setup" });
});
test("no user agent is setup, even with a token", () => {
  assert.deepEqual(discogsAccess({ DISCOGS_TOKEN: "tok" }, null), { kind: "none", reason: "setup" });
});
test("a whitespace-only token is ignored", () => {
  assert.deepEqual(discogsAccess({ ...UA, DISCOGS_TOKEN: "  " }, null), { kind: "none", reason: "setup" });
});
test("setupMissing lists both names for an empty env", () => {
  assert.deepEqual(setupMissing({}), ["DISCOGS_TOKEN (or DISCOGS_CONSUMER_KEY and DISCOGS_CONSUMER_SECRET)", "DISCOGS_USER_AGENT"]);
  assert.deepEqual(setupMissing({ ...UA, DISCOGS_TOKEN: "x" }), []);
  assert.deepEqual(setupMissing({ ...UA, ...pair }), []);
});

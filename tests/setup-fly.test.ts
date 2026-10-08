import { test } from "node:test";
import assert from "node:assert/strict";
import { appFromArgs, defaultUserAgent, flyCommands, parseAppName, parseSecretNames, passwordError, planSecrets, secretValueError } from "../lib/setup-fly.ts";

test("parseAppName and parseSecretNames", () => {
  assert.equal(parseAppName('# x\napp = "mint-condition"\nprimary_region = "sjc"'), "mint-condition");
  assert.equal(parseAppName("app = 'my-app'"), "my-app");
  assert.equal(parseAppName("primary_region = 'sjc'"), null);
  assert.deepEqual(parseSecretNames('[{"Name":"DISCOGS_TOKEN"},{"name":"APP_PASSWORD_HASH"}]'), ["DISCOGS_TOKEN", "APP_PASSWORD_HASH"]);
  assert.deepEqual(parseSecretNames("not json"), []);
});

test("password and value checks", () => {
  assert.equal(passwordError("twelve chars ok", "twelve chars oK"), "Passwords do not match.");
  assert.equal(passwordError("eleven char", "eleven char"), "Password must be at least 12 characters.");
  assert.equal(passwordError('"quoted pass 12"', '"quoted pass 12"'), "Can't start or end with a quote.");
  assert.equal(passwordError("a=b $c d e f g", "a=b $c d e f g"), null);
  assert.equal(passwordError("twelve chars ok", "twelve chars ok "), null, "a stray space on the repeat doesn't count");
  assert.equal(secretValueError("two\nlines"), "Must be one line.");
  assert.equal(secretValueError("it's fine"), null);
  // Checked on a real Fly app: fly secrets import treats # as a comment, so "abc#def" arrives as "abc".
  assert.equal(secretValueError("abc#def"), "Can't contain #.");
  assert.equal(passwordError("a=b $c # d ok", "a=b $c # d ok"), "Can't contain #.");
  assert.equal(secretValueError("a\\nb `x` ${HOME} te\"st"), null, "these arrive verbatim");
});

test("planSecrets builds import lines and drops the old hash", () => {
  assert.deepEqual(planSecrets(["DISCOGS_TOKEN"], {}), { importText: "", set: [], unset: [] });
  assert.deepEqual(planSecrets(["APP_PASSWORD_HASH"], { password: "a=b $c d e f g", userAgent: "MintCondition/0.1 (+me@x.com)" }), {
    importText: "DISCOGS_USER_AGENT=MintCondition/0.1 (+me@x.com)\nAPP_PASSWORD=a=b $c d e f g\n",
    set: ["DISCOGS_USER_AGENT", "APP_PASSWORD"],
    unset: ["APP_PASSWORD_HASH"],
  });
  assert.deepEqual(planSecrets([], { token: "tok" }).set, ["DISCOGS_TOKEN"]);
  assert.equal(defaultUserAgent("me@x.com"), "MintCondition/0.1 (+me@x.com)");
});

test("flyCommands: replacing a hash stages both changes and applies them in one restart", () => {
  const swap = planSecrets(["APP_PASSWORD_HASH"], { password: "twelve chars ok" });
  assert.deepEqual(flyCommands("my-app", swap), [
    ["secrets", "import", "-a", "my-app", "--stage"],
    ["secrets", "unset", "APP_PASSWORD_HASH", "-a", "my-app", "--stage"],
    ["secrets", "deploy", "-a", "my-app"],
  ]);
  assert.deepEqual(flyCommands("my-app", planSecrets([], { token: "t" })), [["secrets", "import", "-a", "my-app"]]);
  assert.deepEqual(flyCommands("my-app", planSecrets([], {})), []);
});

test("appFromArgs: --app picks another app, otherwise fly.toml's", () => {
  const toml = "app = 'mint-condition'";
  assert.equal(appFromArgs(["--app", "mc-x"], toml), "mc-x");
  assert.equal(appFromArgs([], toml), "mint-condition");
  assert.throws(() => appFromArgs(["--app", "MC_X"], toml), /isn't a valid Fly app name/);
  assert.throws(() => appFromArgs(["--app"], toml), /--app needs a name/);
  assert.throws(() => appFromArgs([], ""), /Create the app first/);
});

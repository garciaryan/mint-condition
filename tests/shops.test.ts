import { test } from "node:test";
import assert from "node:assert/strict";
import { isFlyAppName, parseShopApps } from "../lib/shops.ts";

const CANARY = "mint-condition";
const one = (app: string, token = "FLY_TOKEN_A") => JSON.stringify([{ app, token }]);

test("isFlyAppName follows Fly's naming rules", () => {
  for (const ok of ["mint-condition", "mc-groove-records", "a1b"]) assert.equal(isFlyAppName(ok), true, ok);
  for (const bad of ["MC_Shop", "-mc", "mc-", "ab", "", "a".repeat(64)]) assert.equal(isFlyAppName(bad), false, bad);
});

test("no shops when FLY_SHOP_APPS is unset, empty or []", () => {
  for (const raw of [undefined, "", "  ", "[]"]) assert.deepEqual(parseShopApps(raw, CANARY), [], String(raw));
});

test("valid shops come back in order", () => {
  assert.deepEqual(parseShopApps(one("mc-a"), CANARY), [{ app: "mc-a", token: "FLY_TOKEN_A" }]);
  const two = JSON.stringify([
    { app: "mc-a", token: "FLY_TOKEN_A" },
    { app: "mc-groove-records", token: "FLY_TOKEN_GROOVE" },
  ]);
  assert.deepEqual(parseShopApps(two, CANARY), [
    { app: "mc-a", token: "FLY_TOKEN_A" },
    { app: "mc-groove-records", token: "FLY_TOKEN_GROOVE" },
  ]);
});

test("bad values are refused with a message naming the entry and field", () => {
  const bad: [string, RegExp][] = [
    ["{", /FLY_SHOP_APPS isn't valid JSON/],
    ['{"app":"x"}', /FLY_SHOP_APPS must be a JSON array/],
    ['["mc-a"]', /FLY_SHOP_APPS\[0\] must be an object/],
    ['[{"app":"mc-a","token":"T","x":1}]', /FLY_SHOP_APPS\[0\] has an unknown key "x"/],
    [one("MC_A"), /FLY_SHOP_APPS\[0\]\.app "MC_A" isn't a valid Fly app name/],
    [one("mc-a", "t-1"), /FLY_SHOP_APPS\[0\]\.token "t-1" isn't a valid secret name/],
    [one("mc-a", "GITHUB_X"), /FLY_SHOP_APPS\[0\]\.token can't start with GITHUB_/],
    ['[{"app":"mc-a","token":"A"},{"app":"mc-a","token":"B"}]', /FLY_SHOP_APPS\[1\]\.app "mc-a" is listed twice/],
    [one(CANARY), /FLY_SHOP_APPS\[0\]\.app "mint-condition" is the canary/],
  ];
  for (const [raw, msg] of bad) assert.throws(() => parseShopApps(raw, CANARY), msg, raw);
});

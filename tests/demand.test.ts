import { test } from "node:test";
import assert from "node:assert/strict";
import { demand } from "../lib/demand.ts";
import type { MarketplaceStats } from "../lib/types.ts";

const D = { fastWantHave: 1, fastMaxForSale: 10, slowWantHave: 0.3, slowForSale: 200 };
const st = (have: number, want: number, numForSale: number): MarketplaceStats => ({ lowestPrice: 1, currency: null, numForSale, have, want });

test("fast at its edges: want/have exactly 1 and exactly 10 for sale", () => {
  assert.equal(demand(st(10, 10, 10), D), "fast");
  assert.equal(demand(st(10, 10, 11), D), "normal");
});

test("slow at its edges: want/have under 0.3, or 200 or more for sale", () => {
  assert.equal(demand(st(10, 2, 5), D), "slow");
  assert.equal(demand(st(10, 3, 5), D), "normal");
  assert.equal(demand(st(100, 150, 200), D), "slow");
  assert.equal(demand(st(100, 150, 199), D), "normal");
});

test("no owners but some wants is as high as want/have gets; nothing at all is no signal", () => {
  assert.equal(demand(st(0, 5, 3), D), "fast");
  assert.equal(demand(st(0, 0, 3), D), null);
});

test("no stats, or a row priced before want/have was stored, is no signal", () => {
  assert.equal(demand(null, D), null);
  assert.equal(demand({ lowestPrice: 1, currency: null, numForSale: 3 }, D), null);
});

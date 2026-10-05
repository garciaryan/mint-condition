import { test } from "node:test";
import assert from "node:assert/strict";
import { relativeTime } from "../lib/relative-time.ts";

test("relativeTime", () => {
  const now = Date.UTC(2026, 9, 4, 12);
  assert.equal(relativeTime(now - 30_000, now), "just now");
  assert.equal(relativeTime(now - 5 * 60_000, now), "5 minutes ago");
  assert.equal(relativeTime(now - 3 * 3_600_000, now), "3 hours ago");
  assert.equal(relativeTime(now - 86_400_000, now), "yesterday");
  assert.equal(relativeTime(now - 3 * 86_400_000, now), "3 days ago");
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { closeReason } from "../lib/disclosure.ts";

test("an open menu closes on Escape and returns focus to its button", () => {
  assert.equal(closeReason({ type: "keydown", key: "Escape" }), "escape");
  assert.equal(closeReason({ type: "keydown", key: "Enter" }), null);
  assert.equal(closeReason({ type: "keydown", key: "Tab" }), null);
});

test("an open menu closes on a tap outside it, not inside", () => {
  assert.equal(closeReason({ type: "pointerdown", inside: false }), "outside");
  assert.equal(closeReason({ type: "pointerdown", inside: true }), null);
});

test("an open menu closes when focus leaves it", () => {
  assert.equal(closeReason({ type: "focusin", inside: false }), "outside");
  assert.equal(closeReason({ type: "focusin", inside: true }), null);
});

test("a closing dialog hands focus back only if nothing else took it meanwhile", async () => {
  const { shouldRestoreFocus } = await import("../lib/disclosure.ts");
  assert.equal(shouldRestoreFocus({ onBody: true, insideDialog: false }), true);
  assert.equal(shouldRestoreFocus({ onBody: false, insideDialog: true }), true);
  // e.g. a search result heading focused while the scanner was fading out
  assert.equal(shouldRestoreFocus({ onBody: false, insideDialog: false }), false);
});

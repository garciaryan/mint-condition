import { test } from "node:test";
import assert from "node:assert/strict";
import { cameraSupport } from "../lib/camera.ts";
import { clearsInputs } from "../lib/form.ts";

test("the camera is offered over HTTPS (or localhost) when the browser has getUserMedia", () => {
  assert.deepEqual(cameraSupport({ secure: true, getUserMedia: true }), { ok: true });
});

test("over plain http the scan icon explains that the camera needs HTTPS", () => {
  const s = cameraSupport({ secure: false, getUserMedia: false });
  assert.equal(s.ok, false);
  assert.ok(!s.ok && s.reason === "insecure" && /HTTPS/.test(s.message));
});

test("a secure page without camera access says there's no camera", () => {
  const s = cameraSupport({ secure: true, getUserMedia: false });
  assert.ok(!s.ok && s.reason === "no-camera" && /type the number/i.test(s.message));
});

test("the lookup form clears catalog number and year once a pressing is shown, not when you may need to fix them", () => {
  assert.equal(clearsInputs("priced"), true);
  assert.equal(clearsInputs("no-price"), true);
  for (const s of ["candidates", "no-match", "error"] as const) assert.equal(clearsInputs(s), false, s);
});

test("the scan ✓ shows right after a read and hides after its hold time", async () => {
  const { scanCueVisible, LOT_CUE_MS } = await import("../lib/camera.ts");
  assert.equal(scanCueVisible(null, 1000, LOT_CUE_MS), false);
  assert.equal(scanCueVisible(1000, 1000, LOT_CUE_MS), true);
  assert.equal(scanCueVisible(1000, 1000 + LOT_CUE_MS - 1, LOT_CUE_MS), true);
  assert.equal(scanCueVisible(1000, 1000 + LOT_CUE_MS, LOT_CUE_MS), false);
});

test("the one-shot scanner holds the ✓ briefly before closing, shorter than the lot cue", async () => {
  const { LOOKUP_HOLD_MS, LOT_CUE_MS } = await import("../lib/camera.ts");
  assert.ok(LOOKUP_HOLD_MS >= 400 && LOOKUP_HOLD_MS <= 700);
  assert.ok(LOT_CUE_MS >= LOOKUP_HOLD_MS);
});

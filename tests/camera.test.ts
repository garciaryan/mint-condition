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

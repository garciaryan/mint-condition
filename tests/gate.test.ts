import { test } from "node:test";
import assert from "node:assert/strict";
import { gate } from "../lib/gate.ts";
import type { GateRequest } from "../lib/gate.ts";
import { signSession } from "../lib/auth.ts";

const NOW = 1_000_000;
const ON = { APP_PASSWORD_HASH: "scrypt$x", SESSION_SECRET: "s3cret" };
const req = (o: Partial<GateRequest> = {}): GateRequest => ({
  method: "GET", path: "/", search: "", origin: null, host: "app.fly.dev", cookie: undefined, ...o,
});

test("cross-origin or origin-less non-GET gets 403 forbidden, even on public paths", async () => {
  for (const origin of ["https://evil.com", null, "not a url"]) {
    const r = await gate(req({ method: "POST", path: "/api/login", origin }), ON, NOW);
    assert.equal(r.kind, "json");
    if (r.kind === "json") {
      assert.equal(r.status, 403);
      assert.equal(r.body.kind, "forbidden");
    }
  }
  const same = await gate(req({ method: "POST", path: "/api/login", origin: "https://app.fly.dev" }), ON, NOW);
  assert.deepEqual(same, { kind: "pass" });
});

test("a GET with no origin passes the origin check", async () => {
  assert.deepEqual(await gate(req({ path: "/login" }), ON, NOW), { kind: "pass" });
  assert.deepEqual(await gate(req({ method: "HEAD", path: "/login" }), ON, NOW), { kind: "pass" });
});

test("public paths pass without a cookie", async () => {
  for (const path of ["/login", "/api/health", "/favicon.ico", "/_next/static/x.js"]) {
    assert.deepEqual(await gate(req({ path }), ON, NOW), { kind: "pass" });
  }
});

test("misconfigured: API gets JSON 503 missing-env, pages get text 503", async () => {
  const env = { APP_PASSWORD_HASH: "scrypt$x" };
  const msg = "Login not configured: missing SESSION_SECRET";
  const api = await gate(req({ path: "/api/lookup", method: "POST", origin: "https://app.fly.dev" }), env, NOW);
  assert.deepEqual(api, { kind: "json", status: 503, body: { status: "error", kind: "missing-env", message: msg } });
  assert.deepEqual(await gate(req({ path: "/" }), env, NOW), { kind: "text", status: 503, body: msg });
  const none = await gate(req({ path: "/" }), { NODE_ENV: "production" }, NOW);
  assert.equal(none.kind === "text" && none.body, "Login not configured: missing APP_PASSWORD");
  const both = await gate(req({ path: "/api/lookup", method: "POST", origin: "https://app.fly.dev" }),
    { APP_PASSWORD: "x", APP_PASSWORD_HASH: "h", SESSION_SECRET: "s" }, NOW);
  assert.deepEqual(both, { kind: "json", status: 503, body: { status: "error", kind: "missing-env", message: "Set only one of APP_PASSWORD and APP_PASSWORD_HASH." } });
});

test("production env with no login secrets: 503 for lookup, pass for health", async () => {
  const env = { NODE_ENV: "production" };
  const r = await gate(req({ path: "/api/lookup", method: "POST", origin: "https://app.fly.dev" }), env, NOW);
  assert.equal(r.kind === "json" && r.status, 503);
  assert.deepEqual(await gate(req({ path: "/api/health" }), env, NOW), { kind: "pass" });
});

test("auth off passes everything", async () => {
  assert.deepEqual(await gate(req({ path: "/api/lookup", method: "POST", origin: "https://app.fly.dev" }), {}, NOW), { kind: "pass" });
  assert.deepEqual(await gate(req({ path: "/" }), {}, NOW), { kind: "pass" });
});

test("valid cookie passes; invalid does not", async () => {
  const value = await signSession("s3cret", NOW);
  assert.deepEqual(await gate(req({ cookie: value }), ON, NOW + 1), { kind: "pass" });
  const bad = await gate(req({ cookie: value + "x" }), ON, NOW + 1);
  assert.equal(bad.kind, "redirect");
});

test("signed out: API gets JSON 401 auth, pages redirect to login with next", async () => {
  const api = await gate(req({ path: "/api/lookup", method: "POST", origin: "https://app.fly.dev" }), ON, NOW);
  assert.deepEqual(api, { kind: "json", status: 401, body: { status: "error", kind: "auth", message: "Signed out. Log in again." } });
  assert.deepEqual(await gate(req({ path: "/", search: "?x=1" }), ON, NOW), { kind: "redirect", location: "/login?next=%2F%3Fx%3D1" });
});

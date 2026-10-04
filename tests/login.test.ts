import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { hashPassword } from "../lib/password.ts";
import { POST as login } from "../app/api/login/route.ts";
import { POST as logout } from "../app/api/logout/route.ts";

const saved = { ...process.env };
before(() => {
  process.env.APP_PASSWORD_HASH = hashPassword("right password 1");
  process.env.SESSION_SECRET = "test-secret";
  delete (process.env as Record<string, string | undefined>).NODE_ENV;
});
after(() => {
  for (const k of ["APP_PASSWORD_HASH", "SESSION_SECRET", "NODE_ENV"]) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const post = (body: unknown, ip: string, raw = false) =>
  login(new Request("http://localhost/api/login", {
    method: "POST",
    headers: { "content-type": "application/json", "fly-client-ip": ip },
    body: raw ? String(body) : JSON.stringify(body),
  }));

test("wrong password: 401, no cookie", async () => {
  const r = await post({ password: "nope" }, "10.0.0.1");
  assert.equal(r.status, 401);
  assert.equal(r.headers.get("set-cookie"), null);
  assert.equal((await r.json()).kind, "auth");
});

test("right password: 200 and a hardened session cookie", async () => {
  const r = await post({ password: "right password 1" }, "10.0.0.2");
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true });
  const c = r.headers.get("set-cookie") ?? "";
  for (const part of ["mc_session=", "HttpOnly", "SameSite=Lax", "Max-Age=2592000", "Path=/"]) assert.ok(c.includes(part), part);
  assert.ok(!c.includes("Secure"));
});

test("bad bodies get 400", async () => {
  assert.equal((await post("not json", "10.0.0.3", true)).status, 400);
  assert.equal((await post({}, "10.0.0.3")).status, 400);
  assert.equal((await post({ password: 5 }, "10.0.0.3")).status, 400);
});

test("sixth wrong attempt from one IP is 429 with retryAfterMinutes", async () => {
  for (let i = 0; i < 5; i++) assert.equal((await post({ password: "bad" }, "10.0.0.4")).status, 401);
  const r = await post({ password: "bad" }, "10.0.0.4");
  assert.equal(r.status, 429);
  assert.equal((await r.json()).retryAfterMinutes, 15);
  assert.equal((await post({ password: "right password 1" }, "10.0.0.4")).status, 429);
});

test("concurrent wrong attempts cannot exceed the cap", async () => {
  const rs = await Promise.all(Array.from({ length: 10 }, () => post({ password: "bad" }, "10.0.0.8")));
  const codes = rs.map((r) => r.status);
  assert.ok(codes.filter((c) => c === 429).length >= 5, codes.join(","));
  assert.ok(!codes.includes(200));
});

test("a correct login clears the IP's failure count", async () => {
  const ip = "10.0.0.5";
  for (let i = 0; i < 4; i++) assert.equal((await post({ password: "bad" }, ip)).status, 401);
  assert.equal((await post({ password: "right password 1" }, ip)).status, 200);
  for (let i = 0; i < 4; i++) assert.equal((await post({ password: "bad" }, ip)).status, 401);
  assert.equal((await post({ password: "bad" }, ip)).status, 401);
});

test("production without APP_PASSWORD_HASH gives 503", async () => {
  const env = process.env as Record<string, string | undefined>;
  const prev = { h: env.APP_PASSWORD_HASH, n: env.NODE_ENV };
  delete env.APP_PASSWORD_HASH;
  env.NODE_ENV = "production";
  try {
    const r = await post({ password: "x" }, "10.0.0.6");
    assert.equal(r.status, 503);
    assert.equal((await r.json()).kind, "missing-env");
  } finally {
    env.APP_PASSWORD_HASH = prev.h;
    if (prev.n === undefined) delete env.NODE_ENV;
    else env.NODE_ENV = prev.n;
  }
});

test("login is disabled (400) when auth is off", async () => {
  const env = process.env as Record<string, string | undefined>;
  const prev = { h: env.APP_PASSWORD_HASH, s: env.SESSION_SECRET };
  delete env.APP_PASSWORD_HASH;
  delete env.SESSION_SECRET;
  try {
    const r = await post({ password: "x" }, "10.0.0.7");
    assert.equal(r.status, 400);
    assert.equal((await r.json()).message, "Login is disabled locally.");
  } finally {
    env.APP_PASSWORD_HASH = prev.h;
    env.SESSION_SECRET = prev.s;
  }
});

test("logout clears the cookie", async () => {
  const r = await logout();
  assert.equal(r.status, 200);
  const c = r.headers.get("set-cookie") ?? "";
  assert.ok(c.includes("mc_session=") && c.includes("Max-Age=0"));
});

test("oversized content-length gets 400 before the body is read", async () => {
  const r = await login(new Request("http://localhost/api/login", {
    method: "POST",
    headers: { "content-type": "application/json", "fly-client-ip": "10.0.1.1", "content-length": "5000" },
    body: JSON.stringify({ password: "x" }),
  }));
  assert.equal(r.status, 400);
  assert.equal((await r.json()).message, "Request too large.");
});

test("1025-char password gets 400 and does not use a limiter attempt", async () => {
  const ip = "10.0.1.2";
  const r = await post({ password: "a".repeat(1025) }, ip);
  assert.equal(r.status, 400);
  assert.equal((await r.json()).message, "Password is too long.");
  for (let i = 0; i < 5; i++) assert.equal((await post({ password: "bad" }, ip)).status, 401);
  assert.equal((await post({ password: "bad" }, ip)).status, 429);
});

test("session cookie is Secure in production", async () => {
  const env = process.env as Record<string, string | undefined>;
  const prev = env.NODE_ENV;
  env.NODE_ENV = "production";
  try {
    const r = await post({ password: "right password 1" }, "10.0.1.3");
    assert.equal(r.status, 200);
    assert.ok((r.headers.get("set-cookie") ?? "").includes("; Secure"));
  } finally {
    if (prev === undefined) delete env.NODE_ENV;
    else env.NODE_ENV = prev;
  }
});

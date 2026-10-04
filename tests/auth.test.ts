import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SESSION_MAX_AGE_S, signSession, verifySession, authMode, isPublicPath, safeNext,
  createLoginLimiter, clientIp, configStatus,
} from "../lib/auth.ts";
import { hashPassword, verifyPassword } from "../lib/password.ts";

test("verifyPassword accepts the right password, rejects wrong and malformed", () => {
  const h = hashPassword("crate digger");
  assert.match(h, /^scrypt\$16384\$8\$1\$[^$]+\$[^$]+$/);
  assert.equal(verifyPassword("crate digger", h), true);
  assert.equal(verifyPassword("crate diggers", h), false);
  for (const bad of ["", "scrypt$1$2", "bcrypt$x$y$z$a$b", "scrypt$16384$8$1$!!$!!"]) assert.equal(verifyPassword("x", bad), false);
});
test("session cookies verify until expiry and reject tampering", async () => {
  const v = await signSession("s3cret", 1_000);
  assert.equal(await verifySession(v, "s3cret", 1_000 + 1), true);
  assert.equal(await verifySession(v, "s3cret", 1_000 + SESSION_MAX_AGE_S * 1000 + 1), false);
  assert.equal(await verifySession(v, "other", 2_000), false);
  const [exp, sig] = v.split(".");
  assert.equal(await verifySession(`${Number(exp) + 1}.${sig}`, "s3cret", 2_000), false);
});
test("malformed cookies return false without throwing", async () => {
  for (const bad of [undefined, "", "abc", "1.2.3", "x.y", "999999999999999.AAAA", ".", "1."])
    assert.equal(await verifySession(bad, "s3cret", 0), false);
});
test("authMode", () => {
  assert.deepEqual(authMode({}), { mode: "off" });
  assert.deepEqual(authMode({ APP_PASSWORD_HASH: "h", SESSION_SECRET: "s" }), { mode: "on", passwordHash: "h", secret: "s" });
  assert.deepEqual(authMode({ SESSION_SECRET: "s" }), { mode: "misconfigured", missing: ["APP_PASSWORD_HASH"] });
  assert.deepEqual(authMode({ NODE_ENV: "production" }), { mode: "misconfigured", missing: ["APP_PASSWORD_HASH", "SESSION_SECRET"] });
  assert.deepEqual(authMode({ NODE_ENV: "production", APP_PASSWORD_HASH: " ", SESSION_SECRET: "s" }).mode, "misconfigured");
});
test("isPublicPath matches exact public paths only", () => {
  for (const p of ["/login", "/api/login", "/api/health", "/_next/static/x.js", "/favicon.ico"]) assert.equal(isPublicPath(p), true, p);
  for (const p of ["/", "/loginx", "/api/login/x", "/api/healthz", "/_nextx", "/api/lookup"]) assert.equal(isPublicPath(p), false, p);
});
test("safeNext only allows same-origin relative paths", () => {
  assert.equal(safeNext("/collection?id=3"), "/collection?id=3");
  for (const bad of [null, "", "//evil.com", "/\\evil.com", "https://evil.com", "javascript:alert(1)", "%2F%2Fevil.com", "evil",
    "/\t/evil.com", "/\n/evil.com", "/\r\n/evil.com", "/\x00/x"])
    assert.equal(safeNext(bad), "/", String(bad));
});
test("limiter blocks after 5 failures, resets after the window and on success, per IP", () => {
  const l = createLoginLimiter();
  for (let i = 0; i < 5; i++) l.fail("a", 0);
  const blocked = l.check("a", 1_000);
  assert.equal(blocked.ok, false);
  assert.equal(!blocked.ok && blocked.retryAfterMs, 15 * 60_000 - 1_000);
  assert.equal(l.check("b", 1_000).ok, true);
  assert.equal(l.check("a", 15 * 60_000).ok, true);
  const m = createLoginLimiter();
  for (let i = 0; i < 4; i++) m.fail("a", 0);
  m.reset("a");
  for (let i = 0; i < 4; i++) m.fail("a", 0);
  assert.equal(m.check("a", 0).ok, true);
});
test("clientIp prefers Fly-Client-IP, then the first X-Forwarded-For entry, then 'local'", () => {
  assert.equal(clientIp(new Headers({ "fly-client-ip": "1.1.1.1", "x-forwarded-for": "2.2.2.2" })), "1.1.1.1");
  assert.equal(clientIp(new Headers({ "x-forwarded-for": "2.2.2.2, 3.3.3.3" })), "2.2.2.2");
  assert.equal(clientIp(new Headers()), "local");
});
test("configStatus reports presence only, and requires login vars unless login is off", () => {
  const s = configStatus({ DISCOGS_TOKEN: "t", DISCOGS_USER_AGENT: "u" });
  assert.deepEqual(s, { ok: true, vars: { DISCOGS_TOKEN: true, DISCOGS_USER_AGENT: true, APP_PASSWORD_HASH: false, SESSION_SECRET: false } });
  assert.equal(configStatus({ NODE_ENV: "production", DISCOGS_TOKEN: "t", DISCOGS_USER_AGENT: "u" }).ok, false);
  assert.ok(!JSON.stringify(configStatus({ DISCOGS_TOKEN: "secret-value" })).includes("secret-value"));
});

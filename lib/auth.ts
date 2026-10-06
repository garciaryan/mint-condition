// Web Crypto only, so the module stays runtime-agnostic (middleware currently runs on nodejs).

export const SESSION_COOKIE = "mc_session";
export const SESSION_MAX_AGE_S = 2592000;

type Env = Record<string, string | undefined>;

const enc = new TextEncoder();

function b64urlEncode(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): Uint8Array<ArrayBuffer> {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function hmacKey(secret: string, usage: "sign" | "verify"): Promise<CryptoKey> {
  return globalThis.crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [usage]);
}

export async function signSession(secret: string, now: number): Promise<string> {
  const exp = String(now + SESSION_MAX_AGE_S * 1000);
  const sig = await globalThis.crypto.subtle.sign("HMAC", await hmacKey(secret, "sign"), enc.encode(exp));
  return `${exp}.${b64urlEncode(new Uint8Array(sig))}`;
}

export async function verifySession(value: string | undefined, secret: string, now: number): Promise<boolean> {
  try {
    if (!value || !/^\d{1,15}\.[A-Za-z0-9_-]+$/.test(value)) return false;
    const [exp, sig] = value.split(".");
    if (!(Number(exp) > now)) return false;
    return await globalThis.crypto.subtle.verify("HMAC", await hmacKey(secret, "verify"), b64urlDecode(sig), enc.encode(exp));
  } catch {
    return false;
  }
}

export type LoginPassword = { kind: "plain"; value: string } | { kind: "hash"; value: string };

export type AuthMode =
  | { mode: "off" }
  | { mode: "on"; secret: string; password: LoginPassword }
  | { mode: "misconfigured"; missing: string[]; message: string };

const set = (v: string | undefined): string | undefined => (v && v.trim() ? v.trim() : undefined);

export const MIN_PASSWORD_CHARS = 12;

const misconfigured = (missing: string[], message = `Login not configured: missing ${missing.join(" and ")}`): AuthMode => ({
  mode: "misconfigured",
  missing,
  message,
});

// The password comes from APP_PASSWORD (plain) or APP_PASSWORD_HASH (scrypt), never both. SESSION_SECRET comes from
// the environment or, when unset, the file lib/session-secret.ts makes at boot. Without a password, login is off
// outside production.
export function authMode(env: Env): AuthMode {
  const plain = set(env.APP_PASSWORD);
  const hash = set(env.APP_PASSWORD_HASH);
  const secret = set(env.SESSION_SECRET);
  if (plain && hash) return misconfigured([], "Set only one of APP_PASSWORD and APP_PASSWORD_HASH.");
  if (plain && plain.length < MIN_PASSWORD_CHARS) {
    return misconfigured([], `APP_PASSWORD must be at least ${MIN_PASSWORD_CHARS} characters.`);
  }
  const password: LoginPassword | undefined = plain ? { kind: "plain", value: plain } : hash ? { kind: "hash", value: hash } : undefined;
  if (password && secret) return { mode: "on", secret, password };
  if (password) return misconfigured(["SESSION_SECRET"]);
  if (!secret && env.NODE_ENV !== "production") return { mode: "off" };
  return misconfigured(["APP_PASSWORD"]);
}

export function isPublicPath(path: string): boolean {
  return (
    path === "/login" || path === "/api/login" || path === "/api/health" || path === "/favicon.ico" ||
    path.startsWith("/_next/")
  );
}

export function safeNext(next: string | null): string {
  if (!next || !/^\/(?![/\\])/.test(next) || next.includes("\\") || /[\x00-\x1f\x7f]/.test(next)) return "/";
  try {
    return new URL(next, "http://x").origin === "http://x" ? next : "/";
  } catch {
    return "/";
  }
}

export type LoginLimiter = {
  check(ip: string, now: number): { ok: true } | { ok: false; retryAfterMs: number };
  fail(ip: string, now: number): void;
  reset(ip: string): void;
};

export function createLoginLimiter(opts: { max?: number; windowMs?: number } = {}): LoginLimiter {
  const max = opts.max ?? 5;
  const windowMs = opts.windowMs ?? 15 * 60_000;
  const entries = new Map<string, { count: number; firstAt: number }>();
  return {
    check(ip, now) {
      const e = entries.get(ip);
      if (!e) return { ok: true };
      if (now - e.firstAt >= windowMs) {
        entries.delete(ip);
        return { ok: true };
      }
      return e.count >= max ? { ok: false, retryAfterMs: windowMs - (now - e.firstAt) } : { ok: true };
    },
    fail(ip, now) {
      const e = entries.get(ip);
      if (!e || now - e.firstAt >= windowMs) entries.set(ip, { count: 1, firstAt: now });
      else e.count++;
    },
    reset(ip) {
      entries.delete(ip);
    },
  };
}

export function clientIp(headers: Headers): string {
  const fly = headers.get("fly-client-ip")?.trim();
  if (fly) return fly;
  const xff = headers.get("x-forwarded-for")?.split(",")[0].trim();
  return xff || "local";
}

export function configStatus(env: Env): {
  ok: boolean;
  vars: Record<string, boolean>;
  sessionSecretSource: "env" | "file" | null;
} {
  const vars: Record<string, boolean> = {
    DISCOGS_TOKEN: !!set(env.DISCOGS_TOKEN),
    DISCOGS_USER_AGENT: !!set(env.DISCOGS_USER_AGENT),
    APP_PASSWORD: !!set(env.APP_PASSWORD),
    APP_PASSWORD_HASH: !!set(env.APP_PASSWORD_HASH),
    SESSION_SECRET: !!set(env.SESSION_SECRET),
  };
  const mode = authMode(env).mode;
  const ok = vars.DISCOGS_TOKEN && vars.DISCOGS_USER_AGENT && mode !== "misconfigured";
  const sessionSecretSource = !vars.SESSION_SECRET ? null : env.SESSION_SECRET_SOURCE === "file" ? "file" : "env";
  return { ok, vars, sessionSecretSource };
}

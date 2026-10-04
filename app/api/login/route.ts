// POST /api/login: check the password, set the session cookie. Limiter keeps per-IP failures.
import { authMode, clientIp, createLoginLimiter, SESSION_COOKIE, SESSION_MAX_AGE_S, signSession } from "../../../lib/auth.ts";
import type { LoginLimiter } from "../../../lib/auth.ts";
import { verifyPassword } from "../../../lib/password.ts";

export const dynamic = "force-dynamic";

const g = globalThis as typeof globalThis & { __loginLimiter?: LoginLimiter };
const limiter = (): LoginLimiter => (g.__loginLimiter ??= createLoginLimiter());

const FAIL_DELAY_MS = 500;

const err = (status: number, kind: string, message: string, extra: Record<string, unknown> = {}): Response =>
  Response.json({ status: "error", kind, message, ...extra }, { status });

export async function POST(request: Request): Promise<Response> {
  const auth = authMode(process.env);
  if (auth.mode === "off") return err(400, "bad-request", "Login is disabled locally.");
  if (auth.mode === "misconfigured") return err(503, "missing-env", `Login not configured: missing ${auth.missing.join(" and ")}`);

  const body: unknown = await request.json().catch(() => null);
  const password = body && typeof body === "object" ? (body as Record<string, unknown>).password : undefined;
  if (typeof password !== "string" || password === "") return err(400, "bad-request", "Enter the password.");

  // No await between check and fail/reset (verifyPassword is synchronous), so concurrent requests cannot interleave.
  const ip = clientIp(request.headers);
  const lim = limiter();
  const checked = lim.check(ip, Date.now());
  if (!checked.ok) {
    const retryAfterMinutes = Math.ceil(checked.retryAfterMs / 60_000);
    return err(429, "rate-limited", `Too many attempts. Try again in ${retryAfterMinutes} minutes.`, { retryAfterMinutes });
  }

  if (!verifyPassword(password, auth.passwordHash)) {
    lim.fail(ip, Date.now());
    await new Promise((r) => setTimeout(r, FAIL_DELAY_MS));
    return err(401, "auth", "Wrong password.");
  }

  lim.reset(ip);
  const value = await signSession(auth.secret, Date.now());
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  const res = Response.json({ ok: true });
  res.headers.append("set-cookie", `${SESSION_COOKIE}=${value}; Path=/; Max-Age=${SESSION_MAX_AGE_S}; HttpOnly; SameSite=Lax${secure}`);
  return res;
}

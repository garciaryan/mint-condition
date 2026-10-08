// Request gate: pure decision logic for the Next middleware. Web Crypto only (no node: imports).
import { authMode, isPublicPath, verifySession } from "./auth.ts";

export type GateRequest = {
  method: string;
  path: string;
  search: string;
  origin: string | null;
  host: string | null;
  cookie: string | undefined;
};

export type GateResult =
  | { kind: "pass" }
  | { kind: "redirect"; location: string }
  | { kind: "json"; status: 401 | 403 | 503; body: { status: "error"; kind: string; message: string } }
  | { kind: "text"; status: 503; body: string };

const json = (status: 401 | 403 | 503, kind: string, message: string): GateResult => ({
  kind: "json",
  status,
  body: { status: "error", kind, message },
});

// API paths a browser lands on by navigation (Discogs sends the person back here), so a signed-out GET is sent to
// login and returns afterwards, like a page.
const PAGE_LIKE_API = new Set(["/api/discogs/callback"]);

function sameOrigin(origin: string | null, host: string | null): boolean {
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export async function gate(req: GateRequest, env: Record<string, string | undefined>, now: number): Promise<GateResult> {
  const safeMethod = req.method === "GET" || req.method === "HEAD";
  if (!safeMethod && !sameOrigin(req.origin, req.host)) return json(403, "forbidden", "Cross-origin request blocked.");

  if (isPublicPath(req.path)) return { kind: "pass" };

  const auth = authMode(env);
  if (auth.mode === "misconfigured") {
    return req.path.startsWith("/api/") ? json(503, "missing-env", auth.message) : { kind: "text", status: 503, body: auth.message };
  }
  if (auth.mode === "off") return { kind: "pass" };

  if (await verifySession(req.cookie, auth.secret, now)) return { kind: "pass" };

  if (req.path.startsWith("/api/") && !(safeMethod && PAGE_LIKE_API.has(req.path))) return json(401, "auth", "Signed out. Log in again.");
  return { kind: "redirect", location: `/login?next=${encodeURIComponent(req.path + req.search)}` };
}

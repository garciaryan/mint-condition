// Per-route session check (defence in depth: middleware already gates these routes). Server-side only.
import { authMode, SESSION_COOKIE, verifySession } from "./auth.ts";

function cookieValue(header: string | null, name: string): string | undefined {
  for (const part of (header ?? "").split(";")) {
    const p = part.trim();
    if (p.startsWith(`${name}=`)) return p.slice(name.length + 1);
  }
  return undefined;
}

// Returns an error Response when the request must be rejected, or null when it is allowed.
export async function requireSession(request: Request): Promise<Response | null> {
  const mode = authMode(process.env);
  if (mode.mode === "misconfigured") {
    return Response.json(
      { status: "error", kind: "missing-env", message: mode.message },
      { status: 503 },
    );
  }
  if (mode.mode === "on" && !(await verifySession(cookieValue(request.headers.get("cookie"), SESSION_COOKIE), mode.secret, Date.now()))) {
    return Response.json({ status: "error", kind: "auth", message: "Signed out. Log in again." }, { status: 401 });
  }
  return null;
}

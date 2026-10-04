// POST /api/lookup: search by catalog number, or price a chosen release. Server-side only (holds the token).
import { authMode, SESSION_COOKIE, verifySession } from "../../../lib/auth.ts";
import { getDiscogsClient } from "../../../lib/discogs-client.ts";
import { httpStatus, missingEnv, parseLookupRequest, runLookup, toErrorResponse } from "../../../lib/lookup.ts";
import type { LookupResponse } from "../../../lib/lookup.ts";
import { loadSettings } from "../../../lib/settings.ts";

export const dynamic = "force-dynamic";

function reply(res: LookupResponse): Response {
  return Response.json(res, { status: httpStatus(res) });
}

function cookieValue(header: string | null, name: string): string | undefined {
  for (const part of (header ?? "").split(";")) {
    const p = part.trim();
    if (p.startsWith(`${name}=`)) return p.slice(name.length + 1);
  }
  return undefined;
}

export async function POST(request: Request): Promise<Response> {
  // Defence in depth: middleware already gates this route.
  const mode = authMode(process.env);
  if (mode.mode === "misconfigured") {
    const res: LookupResponse = { status: "error", kind: "missing-env", message: `Login not configured: missing ${mode.missing.join(" and ")}` };
    return Response.json(res, { status: 503 });
  }
  if (mode.mode === "on" && !(await verifySession(cookieValue(request.headers.get("cookie"), SESSION_COOKIE), mode.secret, Date.now()))) {
    return reply({ status: "error", kind: "auth", message: "Signed out. Log in again." });
  }

  const missing = missingEnv(process.env);
  if (missing.length > 0) {
    return reply({
      status: "error",
      kind: "missing-env",
      message:
        process.env.NODE_ENV === "production"
          ? `Missing ${missing.join(" and ")}. Set it with fly secrets set and redeploy.`
          : `Missing ${missing.join(" and ")}. Copy .env.example to .env.local, fill it in, and restart the dev server.`,
    });
  }

  let settings;
  try {
    settings = loadSettings();
  } catch (e) {
    return reply({ status: "error", kind: "settings", message: `settings.json is invalid: ${e instanceof Error ? e.message : e}` });
  }

  const parsed = parseLookupRequest(await request.json().catch(() => null));
  if (!parsed.ok) return reply({ status: "error", kind: "bad-request", message: parsed.message });

  try {
    return reply(await runLookup(getDiscogsClient(), parsed.value, settings));
  } catch (e) {
    return reply(toErrorResponse(e));
  }
}

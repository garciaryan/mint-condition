// POST /api/lookup: search by catalog number, or price a chosen release. Server-side only (holds the token).
import { getLookupClient } from "../../../lib/discogs-client.ts";
import { httpStatus, missingEnv, parseLookupRequest, runLookup, toErrorResponse } from "../../../lib/lookup.ts";
import type { LookupResponse } from "../../../lib/lookup.ts";
import { requireSession } from "../../../lib/route-auth.ts";
import { dbUnavailable, getDb } from "../../../lib/db.ts";
import { getSettings } from "../../../lib/settings-store.ts";

export const dynamic = "force-dynamic";

function reply(res: LookupResponse): Response {
  return Response.json(res, { status: httpStatus(res) });
}

export async function POST(request: Request): Promise<Response> {
  const denied = await requireSession(request);
  if (denied) return denied;

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

  let db;
  try {
    db = getDb();
  } catch (e) {
    return reply({ status: "error", kind: "database", message: dbUnavailable(e) });
  }
  let settings;
  try {
    settings = getSettings(db).settings;
  } catch (e) {
    return reply({ status: "error", kind: "settings", message: `settings.json is invalid: ${e instanceof Error ? e.message : e}` });
  }

  const parsed = parseLookupRequest(await request.json().catch(() => null));
  if (!parsed.ok) return reply({ status: "error", kind: "bad-request", message: parsed.message });

  try {
    return reply(await runLookup(getLookupClient(), parsed.value, settings));
  } catch (e) {
    return reply(toErrorResponse(e));
  }
}

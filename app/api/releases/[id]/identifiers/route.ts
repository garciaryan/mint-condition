// GET /api/releases/:id/identifiers: a release's matrix/runout and other identifiers, for the picker's runout
// matching. Goes through the cached client (release:<id>), so pricing that release afterwards reuses it.
import { parseId } from "../../../../../lib/collection/http.ts";
import { getLookupClient } from "../../../../../lib/discogs-client.ts";
import { dbUnavailable, getDb } from "../../../../../lib/db.ts";
import { httpStatus, missingEnv, toErrorResponse } from "../../../../../lib/lookup.ts";
import type { LookupResponse } from "../../../../../lib/lookup.ts";
import { requireSession } from "../../../../../lib/route-auth.ts";
import { getSettings } from "../../../../../lib/settings-store.ts";

export const dynamic = "force-dynamic";

function fail(res: Extract<LookupResponse, { status: "error" }>): Response {
  return Response.json(res, { status: httpStatus(res) });
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const denied = await requireSession(request);
  if (denied) return denied;
  const id = parseId((await params).id);
  if (id === null) return fail({ status: "error", kind: "bad-request", message: "Invalid release id." });
  const missing = missingEnv(process.env);
  if (missing.length > 0) {
    return fail({ status: "error", kind: "missing-env", message: `Missing ${missing.join(" and ")}.` });
  }
  let db;
  try {
    db = getDb();
  } catch (e) {
    return fail({ status: "error", kind: "database", message: dbUnavailable(e) });
  }
  try {
    getSettings(db);
  } catch (e) {
    return fail({ status: "error", kind: "settings", message: `settings.json is invalid: ${e instanceof Error ? e.message : e}` });
  }
  try {
    const { value, fetchedAt } = await getLookupClient().releaseStats(id);
    return Response.json({ identifiers: value.identifiers ?? [], fetchedAt });
  } catch (e) {
    return fail(toErrorResponse(e));
  }
}

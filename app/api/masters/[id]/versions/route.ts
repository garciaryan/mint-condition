// GET /api/masters/:id/versions: a master's vinyl versions (up to 300, oldest first) for the result card's
// "Vinyl versions" panel. Goes through the cached client (versions:<id>).
import { parseId } from "../../../../../lib/collection/http.ts";
import { discogsAccess } from "../../../../../lib/discogs-access.ts";
import { getConnection } from "../../../../../lib/discogs-auth-store.ts";
import { getLookupClient } from "../../../../../lib/discogs-client.ts";
import { dbUnavailable, getDb } from "../../../../../lib/db.ts";
import { discogsReady, httpStatus, toErrorResponse } from "../../../../../lib/lookup.ts";
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
  if (id === null) return fail({ status: "error", kind: "bad-request", message: "Invalid master id." });
  let db;
  try {
    db = getDb();
  } catch (e) {
    return fail({ status: "error", kind: "database", message: dbUnavailable(e) });
  }
  const notReady = discogsReady(discogsAccess(process.env, getConnection(db)), process.env);
  if (notReady) return fail(notReady);
  try {
    getSettings(db);
  } catch (e) {
    return fail({ status: "error", kind: "settings", message: `settings.json is invalid: ${e instanceof Error ? e.message : e}` });
  }
  try {
    const { value, fetchedAt } = await getLookupClient().masterVersions(id);
    return Response.json({ versions: value.versions, total: value.total, fetchedAt });
  } catch (e) {
    return fail(toErrorResponse(e));
  }
}

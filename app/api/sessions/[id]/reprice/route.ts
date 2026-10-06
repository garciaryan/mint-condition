// POST /api/sessions/:id/reprice: re-queue every priced / no-price row that has a release.
import { errorJson, parseId } from "../../../../../lib/collection/http.ts";
import { getSession, repriceSession } from "../../../../../lib/collection/store.ts";
import { kickWorker } from "../../../../../lib/collection/worker.ts";
import { getDb } from "../../../../../lib/db.ts";
import { requireSession } from "../../../../../lib/route-auth.ts";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const denied = await requireSession(request);
  if (denied) return denied;
  const id = parseId((await params).id);
  if (id === null) return errorJson("bad-request", 400, "Invalid id.");
  const db = getDb();
  if (!getSession(db, id)) return errorJson("not-found", 404, "Collection not found.");
  const queued = repriceSession(db, id);
  if (queued > 0) void kickWorker();
  return Response.json({ queued });
}

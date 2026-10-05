// POST /api/sessions/:id/resume: clear the paused flag (e.g. after fixing the Discogs token) and wake the worker.
import { errorJson, parseId } from "../../../../../lib/collection/http.ts";
import { countPending, getSession } from "../../../../../lib/collection/store.ts";
import { queueState } from "../../../../../lib/collection/view.ts";
import { kickWorker, resumeQueue } from "../../../../../lib/collection/worker.ts";
import { getDb } from "../../../../../lib/db.ts";
import { requireSession } from "../../../../../lib/route-auth.ts";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const denied = await requireSession(request);
  if (denied) return denied;
  const id = parseId((await params).id);
  if (id === null) return errorJson("bad-request", 400, "Invalid id.");
  const db = getDb();
  if (!getSession(db, id)) return errorJson("not-found", 404, "Lot not found.");
  resumeQueue();
  void kickWorker();
  return Response.json({ queue: queueState(countPending(db), false) });
}

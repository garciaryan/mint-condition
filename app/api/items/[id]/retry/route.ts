// POST /api/items/:id/retry: re-queue an error / no-match row; also clears a token pause.
import { errorJson, parseId, withSettings } from "../../../../../lib/collection/http.ts";
import { retryItem } from "../../../../../lib/collection/store.ts";
import { toItemView } from "../../../../../lib/collection/view.ts";
import { kickWorker, resumeQueue } from "../../../../../lib/collection/worker.ts";
import { getDb } from "../../../../../lib/db.ts";
import { requireSession } from "../../../../../lib/route-auth.ts";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const denied = await requireSession(request);
  if (denied) return denied;
  const id = parseId((await params).id);
  if (id === null) return errorJson("bad-request", 400, "Invalid id.");
  return withSettings((settings) => {
    const r = retryItem(getDb(), id);
    if (r === "not-found") return errorJson("not-found", 404, "Record not found.");
    if (r === "invalid-state") return errorJson("bad-request", 400, "Only records with an error or no match can be retried.");
    resumeQueue();
    void kickWorker();
    return Response.json(toItemView(r, settings));
  });
}

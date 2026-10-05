// GET /api/items/:id/candidates: the saved pressing matches for a to-pick row.
import { errorJson, parseId } from "../../../../../lib/collection/http.ts";
import { getItem } from "../../../../../lib/collection/store.ts";
import { getDb } from "../../../../../lib/db.ts";
import { requireSession } from "../../../../../lib/route-auth.ts";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const denied = await requireSession(request);
  if (denied) return denied;
  const id = parseId((await params).id);
  if (id === null) return errorJson("bad-request", 400, "Invalid id.");
  const item = getItem(getDb(), id);
  if (!item || !item.candidates) return errorJson("not-found", 404, "No pressings to pick from.");
  return Response.json({ candidates: item.candidates });
}

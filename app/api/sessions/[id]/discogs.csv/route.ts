// GET /api/sessions/:id/discogs.csv: the lot as a Discogs inventory-upload file (draft listings at the sell price).
import { csvFilename, toDiscogsCsv } from "../../../../../lib/collection/export.ts";
import { errorJson, parseId, withSettings } from "../../../../../lib/collection/http.ts";
import { getSession, listItems } from "../../../../../lib/collection/store.ts";
import { getDb } from "../../../../../lib/db.ts";
import { requireSession } from "../../../../../lib/route-auth.ts";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const denied = await requireSession(request);
  if (denied) return denied;
  const id = parseId((await params).id);
  if (id === null) return errorJson("bad-request", 400, "Invalid id.");
  return withSettings((settings) => {
    const db = getDb();
    const session = getSession(db, id);
    if (!session) return errorJson("not-found", 404, "Lot not found.");
    return new Response(toDiscogsCsv(session.name, listItems(db, id), settings), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${csvFilename(session.name, id)}"`,
        "Cache-Control": "no-store",
      },
    });
  });
}

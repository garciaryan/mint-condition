// GET /api/sessions (list lots), POST /api/sessions (create a lot).
import { defaultLotName, errorJson, isObject, MAX_BODY, parseName, readJson, withSettings } from "../../../lib/collection/http.ts";
import { createSession, listItems, listSessions } from "../../../lib/collection/store.ts";
import { computeTotals, hideExpired } from "../../../lib/collection/view.ts";
import { getDb } from "../../../lib/db.ts";
import { requireSession } from "../../../lib/route-auth.ts";
import { isGrade } from "../../../lib/types.ts";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const denied = await requireSession(request);
  if (denied) return denied;
  return withSettings((settings) => {
    const db = getDb();
    const now = Date.now();
    const sessions = listSessions(db).map((s) => {
      const items = hideExpired(listItems(db, s.id), now);
      return {
        id: s.id,
        name: s.name,
        updatedAt: s.updatedAt,
        itemCount: items.length,
        suggested: computeTotals(items, settings).suggested,
        defaultRecord: s.defaultRecord,
        defaultSleeve: s.defaultSleeve,
      };
    });
    return Response.json({ sessions, currency: settings.discogs.currency });
  });
}

export async function POST(request: Request): Promise<Response> {
  const denied = await requireSession(request);
  if (denied) return denied;
  const body = await readJson(request, MAX_BODY);
  if (!body.ok) return body.response;
  const b = body.value;
  if (!isObject(b)) return errorJson("bad-request", 400, "Body must be a JSON object.");
  let name = defaultLotName();
  if (b.name !== undefined) {
    const n = parseName(b.name);
    if (n === null) return errorJson("bad-request", 400, "Name must be 1 to 80 characters.");
    name = n;
  }
  if (typeof b.defaultRecord !== "string" || !isGrade(b.defaultRecord) || typeof b.defaultSleeve !== "string" || !isGrade(b.defaultSleeve)) {
    return errorJson("bad-request", 400, "Pick a default record grade and sleeve grade.");
  }
  const session = createSession(getDb(), { name, defaultRecord: b.defaultRecord, defaultSleeve: b.defaultSleeve }, Date.now());
  return Response.json(session, { status: 201 });
}

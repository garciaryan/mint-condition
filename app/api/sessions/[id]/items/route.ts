// POST /api/sessions/:id/items: add 1-500 lines to a lot, then wake the lookup worker.
import { errorJson, isObject, MAX_BULK_BODY, parseId, parseQuery, parseYear, readJson, withSettings } from "../../../../../lib/collection/http.ts";
import { parseNote } from "../../../../../lib/collection/notes.ts";
import { addItems, getSession } from "../../../../../lib/collection/store.ts";
import { toItemView } from "../../../../../lib/collection/view.ts";
import { kickWorker } from "../../../../../lib/collection/worker.ts";
import { getDb } from "../../../../../lib/db.ts";
import { offerInputs } from "../../../../../lib/offer.ts";
import { requireSession } from "../../../../../lib/route-auth.ts";
import { isGrade } from "../../../../../lib/types.ts";
import type { NewLine } from "../../../../../lib/collection/types.ts";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const denied = await requireSession(request);
  if (denied) return denied;
  const id = parseId((await params).id);
  if (id === null) return errorJson("bad-request", 400, "Invalid id.");
  const body = await readJson(request, MAX_BULK_BODY);
  if (!body.ok) return body.response;
  const b = body.value;
  if (!isObject(b)) return errorJson("bad-request", 400, "Body must be a JSON object.");
  const { record, sleeve } = b;
  if (typeof record !== "string" || !isGrade(record) || typeof sleeve !== "string" || !isGrade(sleeve)) {
    return errorJson("bad-request", 400, "Pick a record grade and a sleeve grade.");
  }
  if (!Array.isArray(b.lines) || b.lines.length < 1 || b.lines.length > 500) {
    return errorJson("bad-request", 400, "Send 1 to 500 lines.");
  }
  const lines: NewLine[] = [];
  for (const [i, raw] of b.lines.entries()) {
    if (!isObject(raw)) return errorJson("bad-request", 400, `Line ${i + 1} is not an object.`);
    const query = parseQuery(raw.query);
    if (query === null) return errorJson("bad-request", 400, `Line ${i + 1}: catalog number must be 1 to 64 characters.`);
    const line: NewLine = { query };
    if (raw.year !== undefined) {
      const y = parseYear(raw.year);
      if (!y.ok) return errorJson("bad-request", 400, `Line ${i + 1}: year must be 1890 to 2100.`);
      if (y.value !== null) line.year = y.value;
    }
    if (raw.notes !== undefined) {
      const n = parseNote(raw.notes);
      if (!n.ok) return errorJson("bad-request", 400, `Line ${i + 1}: ${n.message}`);
      if (n.value) line.notes = n.value;
    }
    lines.push(line);
  }
  return withSettings((settings) => {
    const db = getDb();
    const session = getSession(db, id);
    if (!session) return errorJson("not-found", 404, "Collection not found.");
    const inputs = offerInputs(session, settings);
    const added = addItems(db, id, lines, { record, sleeve }, Date.now());
    void kickWorker();
    return Response.json({ added: added.map((i) => toItemView(i, settings, inputs)) }, { status: 201 });
  });
}

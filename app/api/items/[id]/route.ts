// PATCH/DELETE /api/items/:id
import { errorJson, isObject, MAX_BODY, parseId, parseYear, readJson, withSettings } from "../../../../lib/collection/http.ts";
import { deleteItem, getItem, getSession, pickRelease, setItemPick, updateItemFields } from "../../../../lib/collection/store.ts";
import { parseNote } from "../../../../lib/collection/notes.ts";
import { hideExpired, toItemView } from "../../../../lib/collection/view.ts";
import { kickWorker } from "../../../../lib/collection/worker.ts";
import { getDb } from "../../../../lib/db.ts";
import { offerInputs, offerMarket } from "../../../../lib/offer.ts";
import { requireSession } from "../../../../lib/route-auth.ts";
import { isGrade } from "../../../../lib/types.ts";
import type { Grade } from "../../../../lib/types.ts";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

const notFound = () => errorJson("not-found", 404, "Record not found.");

export async function PATCH(request: Request, { params }: Ctx): Promise<Response> {
  const denied = await requireSession(request);
  if (denied) return denied;
  const id = parseId((await params).id);
  if (id === null) return errorJson("bad-request", 400, "Invalid id.");
  const body = await readJson(request, MAX_BODY);
  if (!body.ok) return body.response;
  const b = body.value;
  if (!isObject(b)) return errorJson("bad-request", 400, "Body must be a JSON object.");

  const fields: { record?: Grade; sleeve?: Grade; year?: number | null; notes?: string } = {};
  for (const key of ["record", "sleeve"] as const) {
    if (b[key] !== undefined) {
      const v = b[key];
      if (typeof v !== "string" || !isGrade(v)) return errorJson("bad-request", 400, "Invalid grade.");
      fields[key] = v;
    }
  }
  if (b.year !== undefined) {
    const y = parseYear(b.year);
    if (!y.ok) return errorJson("bad-request", 400, "Year must be empty or 1890 to 2100.");
    fields.year = y.value;
  }
  if (b.notes !== undefined) {
    const n = parseNote(b.notes);
    if (!n.ok) return errorJson("bad-request", 400, n.message);
    fields.notes = n.value;
  }
  let releaseId: number | undefined;
  if (b.releaseId !== undefined) {
    if (typeof b.releaseId !== "number" || !Number.isInteger(b.releaseId) || b.releaseId <= 0) {
      return errorJson("bad-request", 400, "Invalid release id.");
    }
    if (fields.year !== undefined) return errorJson("bad-request", 400, "Change the year or pick a pressing, not both.");
    releaseId = b.releaseId;
  }

  if (b.pick !== undefined && typeof b.pick !== "boolean") {
    return errorJson("bad-request", 400, "Cherry-pick must be true or false.");
  }
  const pick = b.pick as boolean | undefined;

  return withSettings((settings) => {
    const db = getDb();
    const cur = getItem(db, id);
    if (!cur) return notFound();
    let kick = false;
    if (releaseId !== undefined) {
      const picked = pickRelease(db, id, releaseId);
      if (picked === "not-found") return notFound();
      if (picked === "invalid") return errorJson("bad-request", 400, "That pressing is not one of this record's matches.");
      kick = true;
    }
    if (fields.year !== undefined && fields.year !== cur.year) kick = true;
    const changed = updateItemFields(db, id, fields);
    if (!changed) return notFound();
    let updated = hideExpired([changed], Date.now())[0];
    if (kick) void kickWorker();
    const inputs = offerInputs(getSession(db, updated.sessionId)!, settings);
    if (pick !== undefined) {
      // Checked after grade changes so a combined request is judged at the new grades.
      if (!offerMarket(updated, inputs, settings)) {
        return errorJson("bad-request", 400, "This record has no market value to cherry-pick.");
      }
      const picked = setItemPick(db, id, pick);
      if (!picked) return notFound();
      updated = hideExpired([picked], Date.now())[0];
    }
    return Response.json(toItemView(updated, settings, inputs));
  });
}

export async function DELETE(request: Request, { params }: Ctx): Promise<Response> {
  const denied = await requireSession(request);
  if (denied) return denied;
  const id = parseId((await params).id);
  if (id === null) return errorJson("bad-request", 400, "Invalid id.");
  return deleteItem(getDb(), id) ? Response.json({ ok: true }) : notFound();
}

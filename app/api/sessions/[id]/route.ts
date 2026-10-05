// GET/PATCH/DELETE /api/sessions/:id
import { errorJson, isObject, MAX_BODY, parseAmount, parseId, parseName, readJson, withSettings } from "../../../../lib/collection/http.ts";
import { deleteSession, getSession, listItems, updateSession } from "../../../../lib/collection/store.ts";
import { computeTotals, oldestPricedAt, queueState, toItemView } from "../../../../lib/collection/view.ts";
import { isQueuePaused } from "../../../../lib/collection/worker.ts";
import { getDb } from "../../../../lib/db.ts";
import { computeOffer, offerInputs } from "../../../../lib/offer.ts";
import { requireSession } from "../../../../lib/route-auth.ts";
import { isGrade } from "../../../../lib/types.ts";
import type { SessionPatch } from "../../../../lib/collection/types.ts";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

const notFound = () => errorJson("not-found", 404, "Lot not found.");
const badId = () => errorJson("bad-request", 400, "Invalid id.");

export async function GET(request: Request, { params }: Ctx): Promise<Response> {
  const denied = await requireSession(request);
  if (denied) return denied;
  const id = parseId((await params).id);
  if (id === null) return badId();
  return withSettings((settings) => {
    const db = getDb();
    const session = getSession(db, id);
    if (!session) return notFound();
    const items = listItems(db, id);
    const totals = computeTotals(items, settings);
    const inputs = offerInputs(session, settings);
    return Response.json({
      session,
      items: items.map((i) => toItemView(i, settings, inputs)),
      totals,
      offer: computeOffer(items, inputs, settings),
      queue: queueState(totals.pending, isQueuePaused()),
      oldestPricedAt: oldestPricedAt(items),
      currency: settings.discogs.currency,
    });
  });
}

export async function PATCH(request: Request, { params }: Ctx): Promise<Response> {
  const denied = await requireSession(request);
  if (denied) return denied;
  const id = parseId((await params).id);
  if (id === null) return badId();
  const body = await readJson(request, MAX_BODY);
  if (!body.ok) return body.response;
  const b = body.value;
  if (!isObject(b)) return errorJson("bad-request", 400, "Body must be a JSON object.");
  const patch: SessionPatch = {};
  if (b.name !== undefined) {
    const n = parseName(b.name);
    if (n === null) return errorJson("bad-request", 400, "Name must be 1 to 80 characters.");
    patch.name = n;
  }
  for (const key of ["defaultRecord", "defaultSleeve"] as const) {
    if (b[key] !== undefined) {
      const v = b[key];
      if (typeof v !== "string" || !isGrade(v)) return errorJson("bad-request", 400, "Invalid grade.");
      patch[key] = v;
    }
  }
  if (b.unverified !== undefined) {
    if (typeof b.unverified !== "boolean") return errorJson("bad-request", 400, "Condition unverified must be true or false.");
    patch.unverified = b.unverified;
  }
  // Empty threshold or bulk (null) means "use the settings default"; overhead has no default, so it can't be null.
  const amounts = [
    ["pickThreshold", 100000, true, "Pick threshold must be empty or 0 to 100000."],
    ["bulkEach", 1000, true, "Bulk per record must be empty or 0 to 1000."],
    ["lotOverhead", 100000, false, "Lot overhead must be 0 to 100000."],
  ] as const;
  for (const [key, max, nullable, message] of amounts) {
    if (b[key] === undefined) continue;
    if (b[key] === null && nullable) {
      (patch as Record<string, unknown>)[key] = null;
      continue;
    }
    const v = parseAmount(b[key], max);
    if (v === null) return errorJson("bad-request", 400, message);
    patch[key] = v;
  }
  const session = updateSession(getDb(), id, patch, Date.now());
  return session ? Response.json(session) : notFound();
}

export async function DELETE(request: Request, { params }: Ctx): Promise<Response> {
  const denied = await requireSession(request);
  if (denied) return denied;
  const id = parseId((await params).id);
  if (id === null) return badId();
  return deleteSession(getDb(), id) ? Response.json({ ok: true }) : notFound();
}

// GET /api/settings (current, defaults, saved state), PUT (save), DELETE (reset to settings.json defaults).
import { errorJson, isObject, MAX_BODY, readJson } from "../../../lib/collection/http.ts";
import { getDb } from "../../../lib/db.ts";
import { requireSession } from "../../../lib/route-auth.ts";
import { settingsErrorPath } from "../../../lib/settings.ts";
import { FIELD_KEYS } from "../../../lib/settings-form.ts";
import { getSavedRaw, getSettings, resetSettings, saveSettings } from "../../../lib/settings-store.ts";

export const dynamic = "force-dynamic";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const fileError = (e: unknown) => errorJson("settings", 500, `settings.json is invalid: ${message(e)}`);

function state(): Response {
  const db = getDb();
  let s;
  try {
    s = getSettings(db);
  } catch (e) {
    return fileError(e);
  }
  return Response.json({ ...s, savedRaw: s.invalid ? getSavedRaw(db) : null });
}

export async function GET(request: Request): Promise<Response> {
  const denied = await requireSession(request);
  if (denied) return denied;
  return state();
}

export async function PUT(request: Request): Promise<Response> {
  const denied = await requireSession(request);
  if (denied) return denied;
  const body = await readJson(request, MAX_BODY);
  if (!body.ok) return body.response;
  if (!isObject(body.value)) return errorJson("bad-request", 400, "Body must be a JSON object.");
  const db = getDb();
  try {
    getSettings(db); // settings.json itself must load; that is a 500, not the caller's fault
  } catch (e) {
    return fileError(e);
  }
  try {
    saveSettings(db, body.value);
  } catch (e) {
    const msg = message(e);
    const path = settingsErrorPath(msg);
    const field = path && (FIELD_KEYS as readonly string[]).includes(path) ? path : undefined;
    return Response.json({ status: "error", kind: "bad-request", message: msg, field }, { status: 400 });
  }
  return state();
}

export async function DELETE(request: Request): Promise<Response> {
  const denied = await requireSession(request);
  if (denied) return denied;
  resetSettings(getDb());
  return state();
}

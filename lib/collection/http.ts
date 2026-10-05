// Shared helpers for the collection route handlers. Server-side only.
import { getDb } from "../db.ts";
import { getSettings } from "../settings-store.ts";
import type { Settings } from "../types.ts";

export function errorJson(kind: string, status: number, message: string): Response {
  return Response.json({ status: "error", kind, message }, { status });
}

export async function readJson(
  request: Request,
  maxBytes: number,
): Promise<{ ok: true; value: unknown } | { ok: false; response: Response }> {
  const tooBig = { ok: false as const, response: errorJson("bad-request", 400, `Request body is over ${Math.round(maxBytes / 1024)} KB.`) };
  const len = Number(request.headers.get("content-length"));
  if (Number.isFinite(len) && len > maxBytes) return tooBig;
  let text: string;
  try {
    text = await request.text();
  } catch {
    return { ok: false, response: errorJson("bad-request", 400, "Could not read the request body.") };
  }
  if (Buffer.byteLength(text) > maxBytes) return tooBig;
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, response: errorJson("bad-request", 400, "Body must be valid JSON.") };
  }
}

export function parseId(raw: string): number | null {
  return /^[1-9][0-9]{0,14}$/.test(raw) ? Number(raw) : null;
}

export { __setSettingsPathForTests } from "../settings-store.ts";

export function withSettings<T>(fn: (s: Settings) => T): T | Response {
  let settings: Settings;
  try {
    settings = getSettings(getDb()).settings;
  } catch (e) {
    return errorJson("settings", 500, `settings.json is invalid: ${e instanceof Error ? e.message : e}`);
  }
  return fn(settings);
}

export const MAX_BODY = 64 * 1024;
export const MAX_BULK_BODY = 128 * 1024;
export const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function parseYear(v: unknown): { ok: true; value: number | null } | { ok: false } {
  if (v === null) return { ok: true, value: null };
  if (typeof v === "number" && Number.isInteger(v) && v >= 1890 && v <= 2100) return { ok: true, value: v };
  return { ok: false };
}

/** A finite amount in [0, max], or null when invalid. */
export function parseAmount(v: unknown, max: number): number | null {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= max ? v : null;
}

export function parseQuery(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const q = v.trim();
  return q.length >= 1 && q.length <= 64 ? q : null;
}

export function parseName(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const n = v.trim();
  return n.length >= 1 && n.length <= 80 ? n : null;
}

export function defaultLotName(now = new Date()): string {
  return `Lot ${now.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
}

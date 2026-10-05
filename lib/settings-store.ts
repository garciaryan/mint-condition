// Saved settings (one SQLite row) layered over the settings.json defaults. Server-side only.
import type { DatabaseSync } from "node:sqlite";
import { MAX_CACHE_HOURS } from "./discogs-terms.ts";
import { loadSettings, mergeSettings, parseSettings } from "./settings.ts";
import type { Settings } from "./types.ts";

export type SettingsState = {
  settings: Settings;
  defaults: Settings;
  saved: boolean;
  updatedAt: number | null;
  /** Why the saved row was ignored, when it no longer validates; null otherwise. */
  invalid: string | null;
};

let pathOverride: string | undefined;
export function settingsPath(): string | undefined {
  return pathOverride;
}
export function __setSettingsPathForTests(path: string | null): void {
  pathOverride = path ?? undefined;
}

type Row = { json: string; updated_at: number };
const readRow = (db: DatabaseSync) => db.prepare("select json, updated_at from settings where id = 1").get() as Row | undefined;

export function getSettings(db: DatabaseSync, defaultsPath?: string): SettingsState {
  const defaults = loadSettings(defaultsPath ?? settingsPath());
  const row = readRow(db);
  if (!row) return { settings: defaults, defaults, saved: false, updatedAt: null, invalid: null };
  try {
    const saved: unknown = JSON.parse(row.json);
    if (typeof saved !== "object" || saved === null || Array.isArray(saved)) {
      throw new Error("settings: the saved settings are not an object");
    }
    const settings = parseSettings(capCacheHours(mergeSettings(defaults, moveLegacyFee(saved))));
    return { settings, defaults, saved: true, updatedAt: row.updated_at, invalid: null };
  } catch (e) {
    const invalid = e instanceof Error ? e.message : String(e);
    return { settings: defaults, defaults, saved: true, updatedAt: row.updated_at, invalid };
  }
}

// Rows saved while local sale existed kept the Discogs fee under `local`; it now lives under `sell`. The other local
// values are dropped by the merge (the defaults no longer have them).
function moveLegacyFee(saved: object): object {
  const fee = (saved as { local?: { discogsFeePercent?: unknown } }).local?.discogsFeePercent;
  const sell = (saved as { sell?: Record<string, unknown> }).sell;
  if (fee === undefined || sell?.discogsFeePercent !== undefined) return saved;
  return { ...saved, sell: { ...sell, discogsFeePercent: fee } };
}

// Rows saved before the 6-hour cap may hold more; read them as the cap rather than dropping the whole row.
function capCacheHours(merged: unknown): unknown {
  const d = (merged as { discogs?: { cacheHours?: unknown } }).discogs;
  if (typeof d?.cacheHours !== "number" || !Number.isInteger(d.cacheHours) || d.cacheHours <= MAX_CACHE_HOURS) return merged;
  return { ...(merged as object), discogs: { ...d, cacheHours: MAX_CACHE_HOURS } };
}

/** The stored object as-is, the raw text if it is not valid JSON, or null when nothing is saved. */
export function getSavedRaw(db: DatabaseSync): unknown | null {
  const row = readRow(db);
  if (!row) return null;
  try {
    return JSON.parse(row.json);
  } catch {
    return row.json;
  }
}

/** Validates `input` over the defaults and stores it. Currency is not editable here, so it is left out of the row and
 * always follows settings.json. Throws (row unchanged) when invalid. */
export function saveSettings(db: DatabaseSync, input: unknown, defaultsPath?: string, now = Date.now()): Settings {
  const defaults = loadSettings(defaultsPath ?? settingsPath());
  const settings = parseSettings(mergeSettings(defaults, input));
  const { currency: _currency, ...discogs } = settings.discogs;
  const stored = { ...settings, discogs };
  db.prepare(
    `INSERT INTO settings (id, json, updated_at) VALUES (1, ?, ?)
     ON CONFLICT(id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at`,
  ).run(JSON.stringify(stored), now);
  return settings;
}

export function resetSettings(db: DatabaseSync): void {
  db.prepare("delete from settings where id = 1").run();
}

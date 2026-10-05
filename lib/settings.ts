import { readFileSync } from "node:fs";
import path from "node:path";
import { GRADES } from "./types.ts";
import type { Settings } from "./types.ts";

export function parseSettings(raw: unknown): Settings {
  const s = raw as Settings;
  if (!s || typeof s !== "object") throw new Error("settings: expected an object");
  for (const g of GRADES) {
    const m = s.sleeveMultipliers?.[g];
    if (typeof m !== "number" || m <= 0 || m > 1.5) {
      throw new Error(`settings: sleeveMultipliers.${g} must be a number in (0, 1.5]`);
    }
  }
  const u = s.sell?.undercutPercent;
  if (!isNum(u) || u < 0 || u >= 100) {
    throw new Error("settings: sell.undercutPercent must be in [0, 100)");
  }
  if (!isNum(s.sell?.floor) || s.sell.floor < 0) {
    throw new Error("settings: sell.floor must be >= 0");
  }
  const l = s.local;
  for (const key of ["localDiscountMultiplier", "defaultRegionMultiplier"] as const) {
    if (!isNum(l?.[key]) || l[key] <= 0) throw new Error(`settings: local.${key} must be > 0`);
  }
  if (!isNum(l.discogsFeePercent) || l.discogsFeePercent < 0 || l.discogsFeePercent >= 100) {
    throw new Error("settings: local.discogsFeePercent must be in [0, 100)");
  }
  const h = s.discogs?.cacheHours;
  if (!Number.isInteger(h) || h < 0 || h > 168) {
    throw new Error("settings: discogs.cacheHours must be an integer from 0 to 168");
  }
  parseOffer(s.offer);
  return s;
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function parseOffer(o: Settings["offer"] | undefined): void {
  if (!o || typeof o !== "object") throw new Error("settings: offer must be an object");
  const ladder = o.ladderPercents;
  if (
    !Array.isArray(ladder) || ladder.length < 1 || ladder.length > 8 ||
    !ladder.every((p, i) => isNum(p) && p > 0 && p <= 100 && (i === 0 || p > ladder[i - 1]))
  ) {
    throw new Error("settings: offer.ladderPercents must be 1 to 8 ascending numbers in (0, 100]");
  }
  if (!ladder.includes(o.openingPercent)) {
    throw new Error("settings: offer.openingPercent must be one of offer.ladderPercents");
  }
  if (!isNum(o.marginPercent) || o.marginPercent < 0 || o.marginPercent >= 100) {
    throw new Error("settings: offer.marginPercent must be in [0, 100)");
  }
  for (const key of ["overheadPerRecord", "pickThreshold", "bulkEach"] as const) {
    if (!isNum(o[key]) || o[key] < 0) throw new Error(`settings: offer.${key} must be >= 0`);
  }
  if (!Number.isInteger(o.unverifiedSteps) || o.unverifiedSteps < 1 || o.unverifiedSteps > 3) {
    throw new Error("settings: offer.unverifiedSteps must be an integer from 1 to 3");
  }
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Saved values over defaults: walks the defaults' keys, recursing into objects; arrays and scalars are replaced
 * whole and keys only in `saved` are dropped. Unvalidated: pass the result to parseSettings. */
export function mergeSettings(defaults: Settings, saved: unknown): unknown {
  const merge = (d: unknown, s: unknown): unknown => {
    if (!isPlainObject(d)) return s === undefined ? d : s;
    if (!isPlainObject(s)) return s === undefined ? d : s;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(d)) out[key] = merge(d[key], s[key]);
    return out;
  };
  return isPlainObject(saved) ? merge(defaults, saved) : defaults;
}

/** The dotted setting path a parseSettings error names ("settings: offer.marginPercent must ..."), or null. */
export function settingsErrorPath(message: string): string | null {
  return /^settings: ([A-Za-z]+(?:\.[A-Za-z+]+)+)(?=\s|$)/.exec(message)?.[1] ?? null;
}

export function loadSettings(file = path.join(process.cwd(), "settings.json")): Settings {
  return parseSettings(JSON.parse(readFileSync(file, "utf8")));
}

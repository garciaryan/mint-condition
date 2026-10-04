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
  if (typeof u !== "number" || u < 0 || u >= 100) {
    throw new Error("settings: sell.undercutPercent must be in [0, 100)");
  }
  if (typeof s.sell?.floor !== "number" || s.sell.floor < 0) {
    throw new Error("settings: sell.floor must be >= 0");
  }
  const l = s.local;
  if (!l || l.localDiscountMultiplier <= 0 || l.defaultRegionMultiplier <= 0) {
    throw new Error("settings: local multipliers must be > 0");
  }
  if (l.discogsFeePercent < 0 || l.discogsFeePercent >= 100) {
    throw new Error("settings: local.discogsFeePercent must be in [0, 100)");
  }
  return s;
}

export function loadSettings(file = path.join(process.cwd(), "settings.json")): Settings {
  return parseSettings(JSON.parse(readFileSync(file, "utf8")));
}

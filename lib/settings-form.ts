// Settings page form: Settings <-> string fields, and per-field checks. Pure and client-safe.
import { GRADES } from "./types.ts";
import type { Grade, Settings } from "./types.ts";

export const FIELD_KEYS = [
  "sell.undercutPercent", "sell.floor",
  "local.localDiscountMultiplier", "local.discogsFeePercent", "local.defaultRegionMultiplier",
  "sleeveMultipliers.M", "sleeveMultipliers.NM", "sleeveMultipliers.VG+", "sleeveMultipliers.VG",
  "sleeveMultipliers.G+", "sleeveMultipliers.G", "sleeveMultipliers.F", "sleeveMultipliers.P",
  "offer.ladderPercents", "offer.openingPercent", "offer.marginPercent", "offer.overheadPerRecord",
  "offer.pickThreshold", "offer.bulkEach", "offer.unverifiedSteps",
  "discogs.cacheHours",
] as const;
export type FieldKey = (typeof FIELD_KEYS)[number];
export type SettingsForm = Record<FieldKey, string>;
export type EditableSettings = {
  sleeveMultipliers: Record<Grade, number>;
  sell: Settings["sell"];
  local: Omit<Settings["local"], "regionMultipliers">;
  offer: Settings["offer"];
  discogs: { cacheHours: number };
};

/** Stored as a multiplier (0.8), shown and typed as a percent ("80"). */
export const PERCENT_FIELDS: ReadonlySet<FieldKey> = new Set<FieldKey>([
  "local.localDiscountMultiplier", "local.defaultRegionMultiplier",
  ...GRADES.map((g) => `sleeveMultipliers.${g}` as FieldKey),
]);

type Kind = "mult" | "percent" | "money" | "steps" | "hours" | "ladder";
type Rule = { kind: Kind; ok: (n: number) => boolean; message: string };

const BELOW_100: Rule = { kind: "percent", ok: (n) => n >= 0 && n < 100, message: "Use 0 up to (not including) 100." };
const MONEY: Rule = { kind: "money", ok: (n) => n >= 0, message: "Use 0 or more." };
const POSITIVE_MULT: Rule = { kind: "mult", ok: (n) => n > 0, message: "Use more than 0." };
const SLEEVE: Rule = { kind: "mult", ok: (n) => n >= 1 && n <= 150, message: "Use 1 to 150." };

const RULES: Record<FieldKey, Rule> = {
  "sell.undercutPercent": BELOW_100,
  "sell.floor": MONEY,
  "local.localDiscountMultiplier": POSITIVE_MULT,
  "local.discogsFeePercent": BELOW_100,
  "local.defaultRegionMultiplier": POSITIVE_MULT,
  "sleeveMultipliers.M": SLEEVE, "sleeveMultipliers.NM": SLEEVE, "sleeveMultipliers.VG+": SLEEVE,
  "sleeveMultipliers.VG": SLEEVE, "sleeveMultipliers.G+": SLEEVE, "sleeveMultipliers.G": SLEEVE,
  "sleeveMultipliers.F": SLEEVE, "sleeveMultipliers.P": SLEEVE,
  "offer.ladderPercents": { kind: "ladder", ok: () => true, message: "" },
  "offer.openingPercent": { kind: "percent", ok: () => true, message: "" }, // checked against the ladder
  "offer.marginPercent": BELOW_100,
  "offer.overheadPerRecord": MONEY,
  "offer.pickThreshold": MONEY,
  "offer.bulkEach": MONEY,
  "offer.unverifiedSteps": {
    kind: "steps", ok: (n) => Number.isInteger(n) && n >= 1 && n <= 3, message: "Use a whole number from 1 to 3.",
  },
  "discogs.cacheHours": {
    kind: "hours", ok: (n) => Number.isInteger(n) && n >= 0 && n <= 168, message: "Use a whole number from 0 to 168.",
  },
};

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const split = (key: FieldKey) => key.split(".") as [string, string];

/** The form text for one stored value, or null when the value has the wrong type. */
function formatValue(key: FieldKey, v: unknown): string | null {
  if (RULES[key].kind === "ladder") return Array.isArray(v) && v.every(isNum) ? v.join(", ") : null;
  if (!isNum(v)) return null;
  return RULES[key].kind === "mult" ? String(Math.round(v * 10000) / 100) : String(v);
}

function valueAt(source: unknown, key: FieldKey): unknown {
  const [section, field] = split(key);
  const s = (source as Record<string, unknown> | null)?.[section];
  return typeof s === "object" && s !== null ? (s as Record<string, unknown>)[field] : undefined;
}

export function toForm(s: Settings): SettingsForm {
  return Object.fromEntries(FIELD_KEYS.map((k) => [k, formatValue(k, valueAt(s, k)) ?? ""])) as SettingsForm;
}

/** For a saved object that may not validate: each field shows the saved value when it has the right type, else the default. */
export function toFormLoose(raw: unknown, defaults: Settings): SettingsForm {
  const fallback = toForm(defaults);
  const source = typeof raw === "object" && raw !== null && !Array.isArray(raw) ? raw : null;
  return Object.fromEntries(FIELD_KEYS.map((k) => [k, formatValue(k, valueAt(source, k)) ?? fallback[k]])) as SettingsForm;
}

/** What the page shows after a load or save. A saved row that no longer validates fills the form from the saved values
 * and can be saved as-is (so it can be fixed), with field errors shown straight away. */
export function formView(s: { settings: Settings; defaults: Settings; invalid: string | null; savedRaw: unknown }): {
  form: SettingsForm;
  saveable: boolean;
  showErrors: boolean;
} {
  if (s.invalid) return { form: toFormLoose(s.savedRaw, s.defaults), saveable: true, showErrors: true };
  return { form: toForm(s.settings), saveable: false, showErrors: false };
}

export function parseLadder(text: string): { ok: true; value: number[] } | { ok: false; error: string } {
  const parts = text.split(/[\s,]+/).filter((p) => p !== "");
  const nums = parts.map(Number);
  if (parts.length < 1 || parts.length > 8 || !nums.every((n) => Number.isFinite(n) && n > 0 && n <= 100)) {
    return { ok: false, error: "List 1 to 8 numbers, each above 0 and at most 100." };
  }
  if (!nums.every((n, i) => i === 0 || n > nums[i - 1])) {
    return { ok: false, error: "Each step must be higher than the one before." };
  }
  return { ok: true, value: nums };
}

function parseNumber(text: string): number | null {
  const t = text.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export function fromForm(
  f: SettingsForm,
): { ok: true; value: EditableSettings } | { ok: false; errors: Partial<Record<FieldKey, string>> } {
  const errors: Partial<Record<FieldKey, string>> = {};
  const nums: Partial<Record<FieldKey, number>> = {};
  for (const key of FIELD_KEYS) {
    const rule = RULES[key];
    if (rule.kind === "ladder") continue;
    const n = parseNumber(f[key]);
    if (n === null) errors[key] = "Enter a number.";
    else if (!rule.ok(n)) errors[key] = rule.message;
    else nums[key] = rule.kind === "mult" ? Math.round(n * 100) / 10000 : n;
  }
  const ladder = parseLadder(f["offer.ladderPercents"]);
  if (!ladder.ok) errors["offer.ladderPercents"] = ladder.error;
  else if (nums["offer.openingPercent"] !== undefined && !ladder.value.includes(nums["offer.openingPercent"])) {
    errors["offer.openingPercent"] = "Pick an opening offer from the ladder.";
  }
  if (Object.keys(errors).length > 0 || !ladder.ok) return { ok: false, errors };

  const n = nums as Record<FieldKey, number>;
  return {
    ok: true,
    value: {
      sleeveMultipliers: Object.fromEntries(GRADES.map((g) => [g, n[`sleeveMultipliers.${g}`]])) as Record<Grade, number>,
      sell: { undercutPercent: n["sell.undercutPercent"], floor: n["sell.floor"] },
      local: {
        discogsFeePercent: n["local.discogsFeePercent"],
        localDiscountMultiplier: n["local.localDiscountMultiplier"],
        defaultRegionMultiplier: n["local.defaultRegionMultiplier"],
      },
      offer: {
        ladderPercents: ladder.value,
        openingPercent: n["offer.openingPercent"],
        marginPercent: n["offer.marginPercent"],
        overheadPerRecord: n["offer.overheadPerRecord"],
        pickThreshold: n["offer.pickThreshold"],
        bulkEach: n["offer.bulkEach"],
        unverifiedSteps: n["offer.unverifiedSteps"],
      },
      discogs: { cacheHours: n["discogs.cacheHours"] },
    },
  };
}

/** The default value as the hint shows it: "40%", "$1.50", "1", "30, 40, 50, 60". */
export function formatDefault(key: FieldKey, s: Settings): string {
  const text = formatValue(key, valueAt(s, key)) ?? "";
  switch (RULES[key].kind) {
    case "mult":
    case "percent":
      return `${text}%`;
    case "money":
      return `$${Number(text).toFixed(2)}`;
    default:
      return text;
  }
}

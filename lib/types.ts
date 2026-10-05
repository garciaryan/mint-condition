// Goldmine grades, best to worst. Order matters: index + 1 is "one grade worse".
export const GRADES = ["M", "NM", "VG+", "VG", "G+", "G", "F", "P"] as const;
export type Grade = (typeof GRADES)[number];

export const GRADE_NAMES: Record<Grade, string> = {
  M: "Mint (M)",
  NM: "Near Mint (NM)",
  "VG+": "Very Good Plus (VG+)",
  VG: "Very Good (VG)",
  "G+": "Good Plus (G+)",
  G: "Good (G)",
  F: "Fair (F)",
  P: "Poor (P)",
};

export function isGrade(value: string): value is Grade {
  return (GRADES as readonly string[]).includes(value);
}

export type PriceSuggestions = Partial<Record<Grade, number>>;

export type Settings = {
  sleeveMultipliers: Record<Grade, number>;
  sell: { undercutPercent: number; floor: number; discogsFeePercent: number };
  discogs: { currency: string; cacheHours: number };
  offer: {
    ladderPercents: number[];
    openingPercent: number;
    marginPercent: number;
    overheadPerRecord: number;
    pickThreshold: number;
    bulkEach: number;
    unverifiedSteps: number;
  };
};

export type Candidate = {
  id: number;
  title: string;
  year: number | null;
  country: string | null;
  label: string | null;
  catno: string | null;
  format: string | null;
  thumb: string | null;
};

export type MarketplaceStats = {
  lowestPrice: number | null;
  currency: string | null;
  numForSale: number;
};

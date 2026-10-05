// Pure pricing functions: no network, no filesystem. Everything tunable comes from Settings.
import { GRADES } from "./types.ts";
import type { Grade, PriceSuggestions, Settings } from "./types.ts";

export const roundCents = (n: number): number => Math.round(n * 100) / 100;

export function gradeBelow(g: Grade): Grade | null {
  const i = GRADES.indexOf(g);
  return i >= 0 && i < GRADES.length - 1 ? GRADES[i + 1] : null;
}

export function gradeAbove(g: Grade): Grade | null {
  const i = GRADES.indexOf(g);
  return i > 0 ? GRADES[i - 1] : null;
}

/** Move `steps` grades worse (used for the unverified-condition discount). Clamps at P. */
export function downgrade(g: Grade, steps: number): Grade {
  const i = Math.min(GRADES.indexOf(g) + Math.max(0, steps), GRADES.length - 1);
  return GRADES[i];
}

export function sleeveMultiplier(sleeve: Grade, settings: Settings): number {
  return settings.sleeveMultipliers[sleeve];
}

export type MarketValue = {
  low: number;
  suggested: number;
  high: number;
  /** Discogs's price for the record grade before the sleeve multiplier. */
  basePrice: number;
  sleeveMultiplier: number;
};

/**
 * Fair market value. Base = Discogs suggestion for the record grade, times the sleeve
 * multiplier. The range runs from the next grade down to the next grade up (clamped to
 * the suggested price when a neighbouring grade has no data).
 * Returns null when Discogs has no suggestion for the record grade.
 */
export function marketValue(
  suggestions: PriceSuggestions,
  record: Grade,
  sleeve: Grade,
  settings: Settings,
): MarketValue | null {
  const base = suggestions[record];
  if (base === undefined) return null;
  const mult = sleeveMultiplier(sleeve, settings);
  const suggested = roundCents(base * mult);

  const down = gradeBelow(record);
  const up = gradeAbove(record);
  const downPrice = down && suggestions[down] !== undefined ? suggestions[down]! * mult : suggested;
  const upPrice = up && suggestions[up] !== undefined ? suggestions[up]! * mult : suggested;

  return {
    low: roundCents(Math.min(downPrice, suggested)),
    suggested,
    high: roundCents(Math.max(upPrice, suggested)),
    basePrice: base,
    sleeveMultiplier: mult,
  };
}

export type SellPrice = {
  price: number;
  /** True when the sell price is above Discogs's cheapest current listing (any condition). */
  aboveLowestListing: boolean;
  /** What you would keep after Discogs's seller fee at that price. */
  net: number;
};

/**
 * Sell price: market value nudged down by the undercut, never below the floor.
 * The lowest listing on Discogs can be a worse copy than yours, so it is reported as a
 * flag instead of capping the price.
 */
export function sellPrice(
  market: MarketValue,
  lowestListing: number | null,
  settings: Settings,
): SellPrice {
  const raw = market.suggested * (1 - settings.sell.undercutPercent / 100);
  const price = roundCents(Math.max(raw, settings.sell.floor));
  return {
    price,
    aboveLowestListing: lowestListing !== null && price > lowestListing,
    net: roundCents(price * (1 - settings.sell.discogsFeePercent / 100)),
  };
}

export type PriceResult = {
  record: Grade;
  sleeve: Grade;
  market: MarketValue;
  sell: SellPrice;
};

/** Convenience wrapper that runs the whole pipeline. Returns null if no price data. */
export function priceRecord(args: {
  suggestions: PriceSuggestions;
  lowestListing: number | null;
  record: Grade;
  sleeve: Grade;
  settings: Settings;
}): PriceResult | null {
  const market = marketValue(args.suggestions, args.record, args.sleeve, args.settings);
  if (!market) return null;
  const sell = sellPrice(market, args.lowestListing, args.settings);
  return { record: args.record, sleeve: args.sleeve, market, sell };
}

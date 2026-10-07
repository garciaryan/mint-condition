// How fast a record sells, from Discogs want/have and copies for sale. Pure and client-safe.
import type { MarketplaceStats, Settings } from "./types.ts";

export type Demand = "fast" | "normal" | "slow";

/** Fast when wanted at least as much as owned with few copies for sale; slow when barely wanted or the market is
 * flooded. Null when there is nothing to judge: no stats, a row priced before want/have was stored, or no owners
 * and no wants. No owners but some wants counts as an unlimited want/have. */
export function demand(stats: MarketplaceStats | null, s: Settings["demand"]): Demand | null {
  if (!stats || stats.have === undefined || stats.want === undefined) return null;
  const { have, want, numForSale } = stats;
  if (have === 0 && want === 0) return null;
  const ratio = have === 0 ? Infinity : want / have;
  if (ratio >= s.fastWantHave && numForSale <= s.fastMaxForSale) return "fast";
  if (ratio < s.slowWantHave || numForSale >= s.slowForSale) return "slow";
  return "normal";
}

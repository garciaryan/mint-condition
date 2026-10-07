// Server-side view logic: prices are calculated when read, never stored.
import { MAX_CACHE_HOURS } from "../discogs-terms.ts";
import { isPickRow, offerMarket } from "../offer.ts";
import type { OfferInputs } from "../offer.ts";
import { priceRecord, roundCents } from "../pricing.ts";
import type { Candidate, Grade, MarketplaceStats, Settings } from "../types.ts";
import type { ItemRow, ItemStatus } from "./types.ts";

export type Market = { low: number; suggested: number; high: number };

export function marketFor(item: ItemRow, settings: Settings): Market | null {
  if (!item.suggestions) return null;
  const p = priceRecord({
    suggestions: item.suggestions,
    lowestListing: item.stats?.lowestPrice ?? null,
    record: item.record,
    sleeve: item.sleeve,
    settings,
  });
  if (!p) return null;
  return { low: p.market.low, suggested: p.market.suggested, high: p.market.high };
}

export type ItemView = {
  id: number;
  query: string;
  year: number | null;
  record: Grade;
  sleeve: Grade;
  status: Exclude<ItemStatus, "working"> | "looking-up";
  release: Candidate | null;
  candidateCount: number;
  market: Market | null;
  /** Counted as a cherry-pick in the lot offer (threshold or pin, at the offer grades). */
  isPick: boolean;
  /** Has a market value at the offer grades, so the cherry-pick star can be set. */
  canPick: boolean;
  stats: MarketplaceStats | null;
  pricedAt: number | null;
  error: string | null;
  /** Public listing comment; '' = none. */
  notes: string;
};

export function toItemView(item: ItemRow, settings: Settings, inputs: OfferInputs): ItemView {
  return {
    id: item.id,
    query: item.query,
    year: item.year,
    record: item.record,
    sleeve: item.sleeve,
    status: item.status === "working" ? "looking-up" : item.status,
    release: item.release,
    candidateCount: item.candidateCount ?? item.candidates?.length ?? 0,
    market: marketFor(item, settings),
    isPick: isPickRow(item, inputs, settings),
    canPick: offerMarket(item, inputs, settings) !== null,
    stats: item.stats,
    pricedAt: item.pricedAt,
    error: item.error,
    notes: item.notes,
  };
}

export type Totals = {
  low: number;
  suggested: number;
  high: number;
  total: number;
  priced: number;
  toPick: number;
  noPrice: number;
  problems: number;
  pending: number;
  /** Rows with a market value that are being re-priced (pending/working). Counted in `priced`. */
  refreshing: number;
  /** Rows with a market value whose last refresh failed (error). Counted in `priced`. */
  stale: number;
};

/** Discogs API terms: data more than 6 hours behind discogs.com may not be displayed. */
export const PRICE_MAX_AGE_MS = MAX_CACHE_HOURS * 3_600_000;

/** The rows with Discogs suggestions and stats older than PRICE_MAX_AGE_MS removed, so nothing computed from them
 * (prices, totals, offer, exports) shows expired data. Rows without a fetch time are left as they are. */
export function hideExpired(items: ItemRow[], now: number): ItemRow[] {
  return items.map((i) =>
    i.pricedAt !== null && now - i.pricedAt > PRICE_MAX_AGE_MS && (i.suggestions || i.stats)
      ? { ...i, suggestions: null, stats: null }
      : i,
  );
}

/** When the oldest Discogs data still shown in the lot was fetched, or null when there is none. Counts every row
 * holding suggestions, so a row whose re-price failed (still showing its earlier price) keeps its real age. */
export function oldestPricedAt(items: ItemRow[]): number | null {
  let oldest: number | null = null;
  for (const i of items) {
    if (i.suggestions && i.pricedAt !== null && (oldest === null || i.pricedAt < oldest)) oldest = i.pricedAt;
  }
  return oldest;
}

export function computeTotals(items: ItemRow[], settings: Settings): Totals {
  const t: Totals = { low: 0, suggested: 0, high: 0, total: items.length, priced: 0, toPick: 0, noPrice: 0, problems: 0, pending: 0, refreshing: 0, stale: 0 };
  for (const item of items) {
    const m = marketFor(item, settings);
    // Every row lands in exactly one coverage bucket; a row with a market value is "priced" whatever its status.
    if (m) {
      t.low += m.low;
      t.suggested += m.suggested;
      t.high += m.high;
      t.priced++;
      if (item.status === "pending" || item.status === "working") t.refreshing++;
      else if (item.status === "error") t.stale++;
      continue;
    }
    switch (item.status) {
      case "to-pick": t.toPick++; break;
      case "no-price":
      case "priced": t.noPrice++; break;
      case "no-match":
      case "error": t.problems++; break;
      case "pending":
      case "working": t.pending++; break;
    }
  }
  t.low = roundCents(t.low);
  t.suggested = roundCents(t.suggested);
  t.high = roundCents(t.high);
  return t;
}

export type QueueState = { pending: number; paused: boolean; etaSeconds: number };

export function queueState(pending: number, paused: boolean, msPerItem = 3300): QueueState {
  return { pending, paused, etaSeconds: Math.round((pending * msPerItem) / 1000) };
}

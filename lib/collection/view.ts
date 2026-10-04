// Server-side view logic: prices are calculated when read, never stored.
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
  stats: MarketplaceStats | null;
  pricedAt: number | null;
  error: string | null;
};

export function toItemView(item: ItemRow, settings: Settings): ItemView {
  return {
    id: item.id,
    query: item.query,
    year: item.year,
    record: item.record,
    sleeve: item.sleeve,
    status: item.status === "working" ? "looking-up" : item.status,
    release: item.release,
    candidateCount: item.candidates?.length ?? 0,
    market: marketFor(item, settings),
    stats: item.stats,
    pricedAt: item.pricedAt,
    error: item.error,
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
};

export function computeTotals(items: ItemRow[], settings: Settings): Totals {
  const t: Totals = { low: 0, suggested: 0, high: 0, total: items.length, priced: 0, toPick: 0, noPrice: 0, problems: 0, pending: 0 };
  for (const item of items) {
    const m = marketFor(item, settings);
    if (m) {
      t.low += m.low;
      t.suggested += m.suggested;
      t.high += m.high;
      t.priced++;
    }
    switch (item.status) {
      case "to-pick": t.toPick++; break;
      case "no-price": t.noPrice++; break;
      case "priced": if (!m) t.noPrice++; break;
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

export function queueState(pending: number, paused: boolean): QueueState {
  return { pending, paused, etaSeconds: Math.round(pending * 3 * 1.1) };
}

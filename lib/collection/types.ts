import type { Candidate, Grade, MarketplaceStats, PriceSuggestions } from "../types.ts";

export type ItemStatus = "pending" | "working" | "to-pick" | "priced" | "no-match" | "no-price" | "error";

export type SessionRow = {
  id: number;
  name: string;
  defaultRecord: Grade;
  defaultSleeve: Grade;
  createdAt: number;
  updatedAt: number;
};

export type ItemRow = {
  id: number;
  sessionId: number;
  query: string;
  year: number | null;
  record: Grade;
  sleeve: Grade;
  status: ItemStatus;
  releaseId: number | null;
  release: Candidate | null;
  candidates: Candidate[] | null;
  suggestions: PriceSuggestions | null;
  stats: MarketplaceStats | null;
  pricedAt: number | null;
  error: string | null;
  createdAt: number;
};

export type LookupPatch = {
  status: Exclude<ItemStatus, "working">;
  releaseId?: number | null;
  release?: Candidate | null;
  candidates?: Candidate[] | null;
  suggestions?: PriceSuggestions | null;
  stats?: MarketplaceStats | null;
  pricedAt?: number | null;
  error?: string | null;
};

export type NewLine = { query: string; year?: number };

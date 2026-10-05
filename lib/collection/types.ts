import type { Candidate, Grade, MarketplaceStats, PriceSuggestions } from "../types.ts";

export type ItemStatus = "pending" | "working" | "to-pick" | "priced" | "no-match" | "no-price" | "error";

export type SessionRow = {
  id: number;
  name: string;
  defaultRecord: Grade;
  defaultSleeve: Grade;
  createdAt: number;
  updatedAt: number;
  /** Offer inputs. Null threshold/bulk = use the settings default. */
  unverified: boolean;
  pickThreshold: number | null;
  bulkEach: number | null;
  lotOverhead: number;
};

export type SessionPatch = {
  name?: string;
  defaultRecord?: Grade;
  defaultSleeve?: Grade;
  unverified?: boolean;
  pickThreshold?: number | null;
  bulkEach?: number | null;
  lotOverhead?: number;
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
  /** Set by list reads, which leave `candidates` null to avoid parsing it. */
  candidateCount?: number;
  suggestions: PriceSuggestions | null;
  stats: MarketplaceStats | null;
  pricedAt: number | null;
  error: string | null;
  createdAt: number;
  /** Cherry-pick pin: null = automatic (threshold), true/false = set by the owner. */
  pick: boolean | null;
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

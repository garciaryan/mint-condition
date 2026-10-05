// Discogs answers cached in SQLite for settings.discogs.cacheHours, around the shared throttled client.
// Errors are never cached, and a cache failure never fails a lookup. Server-side only.
import type { DatabaseSync } from "node:sqlite";
import type { LookupClient } from "./lookup.ts";
import type { Candidate, MarketplaceStats, PriceSuggestions } from "./types.ts";

export type Fetched<T> = { value: T; fetchedAt: number };
export type FetchOpts = { fresh?: boolean };
export type CachedLookupClient = {
  searchByCatno(query: string, year: number | undefined, opts?: FetchOpts): Promise<Fetched<Candidate[]>>;
  priceSuggestions(releaseId: number, opts?: FetchOpts): Promise<Fetched<PriceSuggestions | null>>;
  marketplaceStats(releaseId: number, opts?: FetchOpts): Promise<Fetched<MarketplaceStats>>;
};

export function searchKey(query: string, year: number | undefined): string {
  return `search:${query.trim().toLowerCase().replace(/\s+/g, " ")}|${year ?? "-"}`;
}

const HOUR_MS = 3_600_000;
const logError = (what: string, e: unknown) =>
  console.error(`discogs cache: ${what}:`, e instanceof Error ? e.message : "unknown error");

export class CachedClient implements CachedLookupClient {
  private inner: LookupClient;
  private db: () => DatabaseSync;
  private cacheHours: () => number;
  private now: () => number;

  constructor(inner: LookupClient, deps: { db: () => DatabaseSync; cacheHours: () => number; now?: () => number }) {
    this.inner = inner;
    this.db = deps.db;
    this.cacheHours = deps.cacheHours;
    this.now = deps.now ?? Date.now;
  }

  searchByCatno(query: string, year: number | undefined, opts: FetchOpts = {}): Promise<Fetched<Candidate[]>> {
    return this.cached(searchKey(query, year), opts.fresh, () => this.inner.searchByCatno(query, year));
  }

  priceSuggestions(releaseId: number, opts: FetchOpts = {}): Promise<Fetched<PriceSuggestions | null>> {
    return this.cached(`suggestions:${releaseId}`, opts.fresh, () => this.inner.priceSuggestions(releaseId));
  }

  marketplaceStats(releaseId: number, opts: FetchOpts = {}): Promise<Fetched<MarketplaceStats>> {
    return this.cached(`stats:${releaseId}`, opts.fresh, () => this.inner.marketplaceStats(releaseId));
  }

  private ttl(): number {
    try {
      return this.cacheHours() * HOUR_MS;
    } catch (e) {
      logError("cache hours unavailable, not caching", e);
      return 0;
    }
  }

  private async cached<T>(key: string, fresh: boolean | undefined, load: () => Promise<T>): Promise<Fetched<T>> {
    const ttl = this.ttl();
    if (ttl > 0 && !fresh) {
      const hit = this.read<T>(key, ttl);
      if (hit) return hit;
    }
    const value = await load();
    const fetchedAt = this.now();
    if (ttl > 0) this.write(key, value, fetchedAt, ttl);
    return { value, fetchedAt };
  }

  private read<T>(key: string, ttl: number): Fetched<T> | null {
    try {
      const row = this.db().prepare("SELECT json, fetched_at FROM discogs_cache WHERE key = ?").get(key) as
        | { json: string; fetched_at: number }
        | undefined;
      if (!row) return null;
      const age = this.now() - row.fetched_at;
      if (age < 0 || age >= ttl) return null;
      return { value: JSON.parse(row.json) as T, fetchedAt: row.fetched_at };
    } catch (e) {
      if (!(e instanceof SyntaxError)) logError("read failed", e);
      return null;
    }
  }

  private write(key: string, value: unknown, fetchedAt: number, ttl: number): void {
    try {
      const db = this.db();
      db.prepare(
        `INSERT INTO discogs_cache (key, json, fetched_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET json = excluded.json, fetched_at = excluded.fetched_at`,
      ).run(key, JSON.stringify(value), fetchedAt);
      db.prepare("DELETE FROM discogs_cache WHERE fetched_at <= ?").run(fetchedAt - ttl);
    } catch (e) {
      logError("write failed", e);
    }
  }
}

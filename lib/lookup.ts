// Lookup orchestration for the web page: request validation, search-or-price, and error mapping.
// No network of its own; the Discogs client is passed in.
import { demand } from "./demand.ts";
import type { Demand } from "./demand.ts";
import { setupMissing } from "./discogs-access.ts";
import type { DiscogsAccess } from "./discogs-access.ts";
import { DiscogsError } from "./discogs.ts";
import type { CachedLookupClient } from "./discogs-cache.ts";
import { priceRecord } from "./pricing.ts";
import type { PriceResult } from "./pricing.ts";
import { isGrade } from "./types.ts";
import type { Candidate, Grade, MarketplaceStats, PriceSuggestions, Settings } from "./types.ts";

export type LookupRequest = {
  catno: string;
  year?: number;
  record: Grade;
  sleeve: Grade;
  /** Set once the user has picked a pressing (or to re-price one); skips the search. */
  releaseId?: number;
  /** Skip the cache: re-search (without releaseId) and re-fetch suggestions and stats from Discogs. */
  fresh?: boolean;
};

/** When the prices came from Discogs (the older of suggestions and stats), and whether that was before this lookup. */
type Age = { fetchedAt: number; cached: boolean };

export type LookupErrorKind = "bad-request" | "missing-env" | "not-connected" | "settings" | "database" | "bad-token" | "rate-limited" | "upstream" | "auth" | "forbidden";

export type LookupResponse =
  | { status: "candidates"; candidates: Candidate[] }
  | { status: "no-match" }
  | ({
      status: "no-price";
      /** no-suggestions: Discogs has none for the release, or the seller account isn't set up. */
      reason: "no-suggestions" | "grade-missing";
      releaseId: number;
      release: Candidate | null;
      stats: MarketplaceStats;
      /** Settings currency, for the lowest listing. */
      currency: string;
    } & Age)
  | ({
      status: "priced";
      releaseId: number;
      release: Candidate | null;
      stats: MarketplaceStats;
      currency: string;
      result: PriceResult;
      /** How fast it sells (lib/demand.ts); null when Discogs gave no want/have. */
      demand: Demand | null;
    } & Age)
  | { status: "error"; kind: LookupErrorKind; message: string };

export type LookupClient = {
  searchByCatno(catno: string, year?: number): Promise<Candidate[]>;
  priceSuggestions(releaseId: number): Promise<PriceSuggestions | null>;
  releaseStats(releaseId: number): Promise<MarketplaceStats>;
};

type Parsed = { ok: true; value: LookupRequest } | { ok: false; message: string };

export function parseLookupRequest(body: unknown): Parsed {
  if (!body || typeof body !== "object") return { ok: false, message: "Expected a JSON object." };
  const b = body as Record<string, unknown>;

  const catno = typeof b.catno === "string" ? b.catno.trim() : "";
  const releaseId = b.releaseId === undefined || b.releaseId === null || b.releaseId === "" ? undefined : Number(b.releaseId);
  if (releaseId !== undefined && !(Number.isInteger(releaseId) && releaseId > 0)) {
    return { ok: false, message: "Release id must be a positive whole number." };
  }
  if (!catno && releaseId === undefined) return { ok: false, message: "Enter a catalog number or barcode." };

  const year = b.year === undefined || b.year === null || b.year === "" ? undefined : Number(b.year);
  if (year !== undefined && !(Number.isInteger(year) && year >= 1890 && year <= 2100)) {
    return { ok: false, message: "Year must be a four-digit year." };
  }

  const record = String(b.record ?? "");
  const sleeve = String(b.sleeve ?? "");
  if (!isGrade(record) || !isGrade(sleeve)) return { ok: false, message: "Pick a record grade and a sleeve grade." };

  if (b.fresh !== undefined && typeof b.fresh !== "boolean") return { ok: false, message: "fresh must be true or false." };

  return { ok: true, value: { catno, year, record, sleeve, releaseId, ...(b.fresh === true ? { fresh: true } : {}) } };
}

const NOT_CONNECTED = "Connect your Discogs account to start pricing.";

/** The error to return when Discogs can't be called yet, or null when it can. Names missing settings, never values. */
export function discogsReady(access: DiscogsAccess, env: Record<string, string | undefined>): Extract<LookupResponse, { status: "error" }> | null {
  if (access.kind !== "none") return null;
  if (access.reason === "not-connected") return { status: "error", kind: "not-connected", message: NOT_CONNECTED };
  const missing = setupMissing(env).join(" and ");
  return {
    status: "error",
    kind: "missing-env",
    message:
      env.NODE_ENV === "production"
        ? `Missing ${missing}. Set it with fly secrets set and redeploy.`
        : `Missing ${missing}. Copy .env.example to .env.local, fill it in, and restart the dev server.`,
  };
}

/** Maps a thrown error to a response the page can explain. */
export function toErrorResponse(e: unknown): Extract<LookupResponse, { status: "error" }> {
  if (e instanceof DiscogsError) {
    if (e.kind === "not-connected") return { status: "error", kind: "not-connected", message: NOT_CONNECTED };
    if (e.status === 0) return { status: "error", kind: "missing-env", message: e.message };
    if (e.status === 401 && e.kind === "reconnect") return { status: "error", kind: "bad-token", message: e.message };
    if (e.status === 401) {
      return { status: "error", kind: "bad-token", message: "Discogs rejected the token. Check DISCOGS_TOKEN in .env.local and restart the dev server." };
    }
    if (e.status === 429) {
      return { status: "error", kind: "rate-limited", message: "Discogs is rate-limiting requests. Wait a minute and try again." };
    }
    return { status: "error", kind: "upstream", message: e.message };
  }
  return { status: "error", kind: "upstream", message: e instanceof Error ? e.message : "Unexpected error." };
}

/** HTTP status for a response; data outcomes are 200, errors map to the closest code. */
export function httpStatus(res: LookupResponse): number {
  if (res.status !== "error") return 200;
  return { "bad-request": 400, "missing-env": 500, "not-connected": 409, settings: 500, database: 500, "bad-token": 502, "rate-limited": 429, upstream: 502, auth: 401, forbidden: 403 }[res.kind];
}

/**
 * Search when no release is chosen; one match goes straight to pricing, several return
 * candidates for the picker. With a release id, prices that release.
 */
export async function runLookup(
  client: CachedLookupClient,
  req: LookupRequest,
  settings: Settings,
  now: () => number = Date.now,
): Promise<LookupResponse> {
  const startedAt = now();
  let releaseId = req.releaseId;
  let release: Candidate | null = null;

  if (releaseId === undefined) {
    const { value: candidates } = await client.searchByCatno(req.catno, req.year, { fresh: req.fresh });
    if (candidates.length === 0) return { status: "no-match" };
    if (candidates.length > 1) return { status: "candidates", candidates };
    release = candidates[0];
    releaseId = release.id;
  }

  const opts = { fresh: req.fresh };
  const [sugg, st] = await Promise.all([client.priceSuggestions(releaseId, opts), client.releaseStats(releaseId, opts)]);
  const suggestions = sugg.value;
  const stats = st.value;
  const fetchedAt = Math.min(sugg.fetchedAt, st.fetchedAt);
  const age: Age = { fetchedAt, cached: fetchedAt < startedAt };
  if (!suggestions) return { status: "no-price", reason: "no-suggestions", releaseId, release, stats, currency: settings.discogs.currency, ...age };

  const result = priceRecord({
    suggestions,
    lowestListing: stats.lowestPrice,
    record: req.record,
    sleeve: req.sleeve,
    settings,
  });
  if (!result) return { status: "no-price", reason: "grade-missing", releaseId, release, stats, currency: settings.discogs.currency, ...age };

  return { status: "priced", releaseId, release, stats, currency: settings.discogs.currency, result, demand: demand(stats, settings.demand), ...age };
}

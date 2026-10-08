// Minimal Discogs REST client. Server-side only: it holds the personal access token.
import type { DiscogsAccess } from "./discogs-access.ts";
import { newNonce, oauthHeader } from "./discogs-oauth.ts";
import type { Candidate, Grade, Identifier, MarketplaceStats, PriceSuggestions } from "./types.ts";

const BASE = "https://api.discogs.com";

/** Discogs's price_suggestions keys -> our grade codes. */
const SUGGESTION_KEYS: Record<string, Grade> = {
  "Mint (M)": "M",
  "Near Mint (NM or M-)": "NM",
  "Very Good Plus (VG+)": "VG+",
  "Very Good (VG)": "VG",
  "Good Plus (G+)": "G+",
  "Good (G)": "G",
  "Fair (F)": "F",
  "Poor (P)": "P",
};

export class DiscogsError extends Error {
  status: number;
  kind?: "not-connected" | "reconnect";
  constructor(message: string, status: number, kind?: "not-connected" | "reconnect") {
    super(message);
    this.name = "DiscogsError";
    this.status = status;
    if (kind) this.kind = kind;
  }
}

/**
 * Catalog numbers are entered inconsistently ("SD 7208", "SD7208", "SD-7208").
 * Returns the original plus plausible variants, most specific first, without duplicates.
 */
export function catnoVariants(input: string): string[] {
  const original = input.trim().replace(/\s+/g, " ");
  if (!original) return [];
  const out: string[] = [original];
  const add = (v: string) => {
    if (v && !out.some((o) => o.toLowerCase() === v.toLowerCase())) out.push(v);
  };
  const compact = original.replace(/[\s\-_.]+/g, "");
  add(compact);
  add(original.replace(/[\s_]+/g, "-"));
  add(original.replace(/[\-_]+/g, " "));
  // Insert a separator at the letter/digit boundary: SD7208 -> "SD 7208" / "SD-7208".
  const split = compact.replace(/([A-Za-z])(\d)/, "$1 $2");
  if (split !== compact) {
    add(split);
    add(split.replace(" ", "-"));
  }
  return out;
}

/**
 * Digits of a UPC/EAN barcode (8, 12, 13 or 14 digits, spaces and dashes allowed) with a valid check digit,
 * else null. The check digit keeps all-digit catalog numbers from being mistaken for barcodes.
 */
export function barcodeDigits(input: string): string | null {
  const d = input.replace(/[\s\-]+/g, "");
  if (!/^\d+$/.test(d) || ![8, 12, 13, 14].includes(d.length)) return null;
  const body = d.slice(0, -1);
  let sum = 0;
  for (let i = 0; i < body.length; i++) sum += Number(body[body.length - 1 - i]) * (i % 2 === 0 ? 3 : 1);
  return (10 - (sum % 10)) % 10 === Number(d[d.length - 1]) ? d : null;
}

/** A UPC-A and its EAN-13 form (leading 0) are the same code; Discogs may hold either. */
export function barcodeVariants(digits: string): string[] {
  if (digits.length === 12) return [digits, `0${digits}`];
  if (digits.length === 13 && digits.startsWith("0")) return [digits, digits.slice(1)];
  return [digits];
}

/** Keep candidates within `tolerance` years of `year`. Candidates with no year are kept. */
export function filterByYear(candidates: Candidate[], year: number | undefined, tolerance = 1): Candidate[] {
  if (year === undefined) return candidates;
  return candidates.filter((c) => c.year === null || Math.abs(c.year - year) <= tolerance);
}

/** Exact year first, then nearby years, then unknown years. Stable within each group. */
export function sortByYear(candidates: Candidate[], year: number | undefined): Candidate[] {
  if (year === undefined) return candidates;
  const rank = (c: Candidate) => (c.year === null ? 2 : c.year === year ? 0 : 1);
  return candidates.map((c, i) => ({ c, i })).sort((a, b) => rank(a.c) - rank(b.c) || a.i - b.i).map((x) => x.c);
}

type SearchResult = {
  id: number;
  title?: string;
  year?: string | number;
  country?: string;
  label?: string[];
  catno?: string;
  format?: string[];
  thumb?: string;
};

export function toCandidate(r: SearchResult): Candidate {
  const y = r.year === undefined || r.year === "" ? NaN : Number(r.year);
  return {
    id: r.id,
    title: r.title ?? "",
    year: Number.isFinite(y) ? y : null,
    country: r.country ?? null,
    label: r.label?.[0] ?? null,
    catno: r.catno ?? null,
    format: r.format?.join(", ") ?? null,
    thumb: r.thumb || null,
  };
}

/** A version from /masters/{id}/versions. `released` is a year or a full date ("1972-05-12"), sometimes "0". */
type VersionResult = {
  id: number;
  title?: string;
  released?: string;
  country?: string;
  label?: string;
  catno?: string;
  format?: string;
  thumb?: string;
};

/** A master's vinyl versions; `total` counts all of them, even past the pages fetched. */
export type MasterVersions = { versions: Candidate[]; total: number };

/** A version in the same shape as a search candidate, so picking one prices it the same way. */
export function toVersion(r: VersionResult): Candidate {
  const y = Number(r.released?.slice(0, 4));
  return {
    id: r.id,
    title: r.title ?? "",
    year: Number.isInteger(y) && y > 0 ? y : null,
    country: r.country || null,
    label: r.label || null,
    catno: r.catno || null,
    format: r.format || null,
    thumb: r.thumb || null,
  };
}

export function parsePriceSuggestions(body: Record<string, { value?: number } | undefined>): PriceSuggestions {
  const out: PriceSuggestions = {};
  for (const [key, grade] of Object.entries(SUGGESTION_KEYS)) {
    const v = body[key]?.value;
    if (typeof v === "number" && Number.isFinite(v)) out[grade] = v;
  }
  return out;
}

export type ClientOptions = {
  /** Called on every request, so connecting or disconnecting applies at once. */
  auth: () => DiscogsAccess;
  userAgent: string;
  fetchImpl?: typeof fetch;
  /** Minimum gap between requests; Discogs allows 60/min when authenticated. */
  minIntervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  nonce?: () => string;
};

export class DiscogsClient {
  private auth: () => DiscogsAccess;
  private nonce: () => string;
  private userAgent: string;
  private fetchImpl: typeof fetch;
  private minIntervalMs: number;
  private sleep: (ms: number) => Promise<void>;
  private now: () => number;
  private lastRequestAt: number | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(opts: ClientOptions) {
    if (!opts.userAgent) throw new Error("DISCOGS_USER_AGENT is not set (Discogs requires one)");
    this.auth = opts.auth;
    this.nonce = opts.nonce ?? newNonce;
    this.userAgent = opts.userAgent;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.minIntervalMs = opts.minIntervalMs ?? 1100;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.now = opts.now ?? Date.now;
  }

  /** Serialises requests and spaces them out to stay under the rate limit. */
  private throttled<T>(fn: () => Promise<T>): Promise<T> {
    const run = async () => {
      if (this.lastRequestAt !== null) {
        const wait = this.lastRequestAt + this.minIntervalMs - this.now();
        if (wait > 0) await this.sleep(wait);
      }
      this.lastRequestAt = this.now();
      return fn();
    };
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private authorization(access: Exclude<DiscogsAccess, { kind: "none" }>, url: URL): string {
    if (access.kind === "token") return `Discogs token=${access.token}`;
    return oauthHeader({
      method: "GET",
      url: url.toString(),
      consumerKey: access.consumerKey,
      consumerSecret: access.consumerSecret,
      token: access.token,
      tokenSecret: access.secret,
      nonce: this.nonce(),
      timestamp: Math.floor(this.now() / 1000),
    });
  }

  private async get<T>(path: string, params: Record<string, string> = {}, retried = false): Promise<T | null> {
    const url = new URL(BASE + path);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const access = this.auth();
    if (access.kind === "none") {
      if (access.reason === "not-connected") throw new DiscogsError("Connect your Discogs account to start pricing.", 0, "not-connected");
      throw new DiscogsError("Discogs isn't set up for this app.", 0);
    }
    const res = await this.throttled(() =>
      this.fetchImpl(url, {
        headers: {
          Authorization: this.authorization(access, url),
          "User-Agent": this.userAgent,
          Accept: "application/vnd.discogs.v2.discogs+json",
        },
      }),
    );
    if (res.status === 429 && !retried) {
      const secs = Number(res.headers.get("Retry-After") ?? "60");
      await this.sleep((Number.isFinite(secs) ? secs : 60) * 1000);
      return this.get<T>(path, params, true);
    }
    if (res.status === 404) return null;
    if (res.status === 401) {
      throw new DiscogsError(
        access.kind === "oauth"
          ? "Discogs no longer accepts this app's access. Reconnect Discogs in Settings."
          : "Discogs rejected the token (401). Check DISCOGS_TOKEN.",
        401,
        access.kind === "oauth" ? "reconnect" : undefined,
      );
    }
    if (!res.ok) throw new DiscogsError(`Discogs returned ${res.status} for ${path}`, res.status);
    return (await res.json()) as T;
  }

  /**
   * Search releases by catalog number or barcode, trying normalised variants until one returns results.
   * Input that looks like a UPC/EAN is searched as a barcode first, then as a catno.
   * Popular catnos have hundreds of pressings, so pages are followed up to `maxPages` (100 each).
   */
  async searchByCatno(catno: string, year?: number, yearTolerance = 1, maxPages = 3): Promise<Candidate[]> {
    const barcode = barcodeDigits(catno);
    const queries: Record<string, string>[] = [
      ...(barcode ? barcodeVariants(barcode).map((b) => ({ barcode: b })) : []),
      ...catnoVariants(catno).map((c) => ({ catno: c })),
    ];
    for (const query of queries) {
      const found: Candidate[] = [];
      for (let page = 1; page <= maxPages; page++) {
        const body = await this.get<{ results?: SearchResult[]; pagination?: { pages?: number } }>("/database/search", {
          ...query,
          type: "release",
          per_page: "100",
          page: String(page),
        });
        found.push(...(body?.results ?? []).map(toCandidate));
        if (page >= (body?.pagination?.pages ?? 1)) break;
      }
      const filtered = filterByYear(found, year, yearTolerance);
      if (filtered.length > 0) return sortByYear(filtered, year);
    }
    return [];
  }

  /** Per-grade suggested prices. Requires a seller account; returns null if unavailable. */
  async priceSuggestions(releaseId: number): Promise<PriceSuggestions | null> {
    const body = await this.get<Record<string, { value?: number }>>(`/marketplace/price_suggestions/${releaseId}`);
    if (!body) return null;
    const parsed = parsePriceSuggestions(body);
    return Object.keys(parsed).length > 0 ? parsed : null;
  }

  /**
   * A master's vinyl versions, oldest first (Discogs sorts by release date), following pages up to `maxPages` (100
   * each). The earliest years are always on the first page, so the "earliest listed" mark holds for big masters.
   */
  async masterVersions(masterId: number, maxPages = 3): Promise<MasterVersions> {
    const versions: Candidate[] = [];
    let total = 0;
    for (let page = 1; page <= maxPages; page++) {
      const body = await this.get<{ versions?: VersionResult[]; pagination?: { pages?: number; items?: number } }>(
        `/masters/${masterId}/versions`,
        { format: "Vinyl", sort: "released", sort_order: "asc", per_page: "100", page: String(page) },
      );
      versions.push(...(body?.versions ?? []).map(toVersion));
      total = body?.pagination?.items ?? versions.length;
      if (page >= (body?.pagination?.pages ?? 1)) break;
    }
    return { versions, total };
  }

  /** Copies for sale, lowest listing, want/have, master and identifiers from /releases/{id}. Replaces
   * /marketplace/stats so pricing stays at two calls per record (live check in the Phase 10 spec). */
  async releaseStats(releaseId: number): Promise<MarketplaceStats> {
    return parseReleaseStats(await this.get<unknown>(`/releases/${releaseId}`));
  }
}

/** The /releases/{id} fields pricing and demand use. `lowest_price` is a bare number in the account's currency, so
 * `currency` is null. Fields a release lacks are left out (have/want) or defaulted. */
export function parseReleaseStats(body: unknown): MarketplaceStats {
  const empty: MarketplaceStats = { lowestPrice: null, currency: null, numForSale: 0 };
  if (!body || typeof body !== "object") return empty;
  const b = body as {
    lowest_price?: unknown;
    num_for_sale?: unknown;
    community?: { have?: unknown; want?: unknown } | null;
    master_id?: unknown;
    identifiers?: unknown;
  };
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
  const out: MarketplaceStats = {
    lowestPrice: num(b.lowest_price) ?? null,
    currency: null,
    numForSale: num(b.num_for_sale) ?? 0,
  };
  const have = num(b.community?.have);
  const want = num(b.community?.want);
  if (have !== undefined) out.have = have;
  if (want !== undefined) out.want = want;
  const master = num(b.master_id);
  out.masterId = master ? master : null;
  out.identifiers = Array.isArray(b.identifiers)
    ? b.identifiers.flatMap((i): Identifier[] => {
        if (!i || typeof i.type !== "string" || typeof i.value !== "string") return [];
        return [typeof i.description === "string" ? { type: i.type, value: i.value, description: i.description } : { type: i.type, value: i.value }];
      })
    : [];
  return out;
}

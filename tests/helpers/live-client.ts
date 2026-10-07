// Test helper: adapts a plain LookupClient fake to the cached client shape, with controllable fetchedAt values.
import type { CachedLookupClient, FetchOpts } from "../../lib/discogs-cache.ts";
import type { LookupClient } from "../../lib/lookup.ts";

export type Method = "search" | "suggestions" | "release";

export function live(
  inner: LookupClient,
  fetchedAt: (method: Method) => number = () => 0,
  seen?: { fresh: (boolean | undefined)[] },
): CachedLookupClient {
  const wrap = async <T>(method: Method, opts: FetchOpts | undefined, load: () => Promise<T>) => {
    seen?.fresh.push(opts?.fresh);
    return { value: await load(), fetchedAt: fetchedAt(method) };
  };
  return {
    searchByCatno: (q, y, opts) => wrap("search", opts, () => inner.searchByCatno(q, y)),
    priceSuggestions: (id, opts) => wrap("suggestions", opts, () => inner.priceSuggestions(id)),
    releaseStats: (id, opts) => wrap("release", opts, () => inner.releaseStats(id)),
  };
}

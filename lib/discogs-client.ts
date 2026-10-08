// One Discogs client per server process so its throttle covers every caller (lookup route and queue worker).
// Kept on globalThis to survive dev reloads. Server-side only.
import { getDb } from "./db.ts";
import { DiscogsClient } from "./discogs.ts";
import { CachedClient } from "./discogs-cache.ts";
import type { CachedLookupClient, CachedVersionsClient } from "./discogs-cache.ts";
import { getSettings } from "./settings-store.ts";

const g = globalThis as typeof globalThis & { __discogsClient?: DiscogsClient };

export function getDiscogsClient(): DiscogsClient {
  g.__discogsClient ??= new DiscogsClient({
    token: process.env.DISCOGS_TOKEN!.trim(),
    userAgent: process.env.DISCOGS_USER_AGENT!.trim(),
  });
  return g.__discogsClient;
}

/** The shared client behind the SQLite response cache. Stateless (the cache lives in the database), so a new one per
 * call is fine and always wraps the current shared client. Cache hours are read per call, so a settings save applies
 * at once. */
export function getLookupClient(): CachedLookupClient & CachedVersionsClient {
  return new CachedClient(getDiscogsClient(), {
    db: getDb,
    cacheHours: () => getSettings(getDb()).settings.discogs.cacheHours,
  });
}

// One Discogs client per server process so its throttle covers every caller (lookup route and queue worker).
// Kept on globalThis to survive dev reloads. Server-side only.
import { DiscogsClient } from "./discogs.ts";

const g = globalThis as typeof globalThis & { __discogsClient?: DiscogsClient };

export function getDiscogsClient(): DiscogsClient {
  g.__discogsClient ??= new DiscogsClient({
    token: process.env.DISCOGS_TOKEN!.trim(),
    userAgent: process.env.DISCOGS_USER_AGENT!.trim(),
  });
  return g.__discogsClient;
}

// Which Discogs access the app uses right now. Pure: the caller passes the env and the stored connection.
import type { Connection } from "./discogs-auth-store.ts";

export type DiscogsAccess =
  | { kind: "token"; token: string }
  | { kind: "oauth"; consumerKey: string; consumerSecret: string; token: string; secret: string; username: string }
  | { kind: "none"; reason: "not-connected" | "setup" };

type Env = Record<string, string | undefined>;

const clean = (v: string | undefined) => (v ?? "").trim();

/** DISCOGS_TOKEN wins; else the consumer pair with a stored connection; else none. A user agent is always required. */
export function discogsAccess(env: Env, connection: Connection | null): DiscogsAccess {
  if (!clean(env.DISCOGS_USER_AGENT)) return { kind: "none", reason: "setup" };
  const token = clean(env.DISCOGS_TOKEN);
  if (token) return { kind: "token", token };
  const consumerKey = clean(env.DISCOGS_CONSUMER_KEY);
  const consumerSecret = clean(env.DISCOGS_CONSUMER_SECRET);
  if (!consumerKey || !consumerSecret) return { kind: "none", reason: "setup" };
  if (!connection) return { kind: "none", reason: "not-connected" };
  return { kind: "oauth", consumerKey, consumerSecret, token: connection.token, secret: connection.secret, username: connection.username };
}

/** Names of the env settings that are missing for any access to work. */
export function setupMissing(env: Env): string[] {
  const out: string[] = [];
  if (!clean(env.DISCOGS_TOKEN) && !(clean(env.DISCOGS_CONSUMER_KEY) && clean(env.DISCOGS_CONSUMER_SECRET))) {
    out.push("DISCOGS_TOKEN (or DISCOGS_CONSUMER_KEY and DISCOGS_CONSUMER_SECRET)");
  }
  if (!clean(env.DISCOGS_USER_AGENT)) out.push("DISCOGS_USER_AGENT");
  return out;
}

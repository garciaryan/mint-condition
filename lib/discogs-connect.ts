// Connect Discogs: the OAuth 1.0a handshake (request token, authorize, access token, identity). Server-side only.
// Deps are injected so tests run without the network; the routes in app/api/discogs/ are thin wrappers.
// Never log or return token or secret values: failures carry only the step and HTTP status.
import type { DatabaseSync } from "node:sqlite";
import { discogsAccess } from "./discogs-access.ts";
import { saveConnection, savePending, takePending } from "./discogs-auth-store.ts";
import { callbackUrl, newNonce, oauthHeader, parseTokenBody } from "./discogs-oauth.ts";
import { discogsReady } from "./lookup.ts";

export type ConnectDeps = {
  db: DatabaseSync;
  env: Record<string, string | undefined>;
  fetchImpl: typeof fetch;
  now: () => number;
  nonce: () => string;
  userAgent: string;
};

/** The real deps for the routes: process env, global fetch (looked up per call), wall clock, random nonces. */
export function routeDeps(db: DatabaseSync): ConnectDeps {
  return {
    db,
    env: process.env,
    fetchImpl: (input, init) => fetch(input, init),
    now: Date.now,
    nonce: newNonce,
    userAgent: (process.env.DISCOGS_USER_AGENT ?? "").trim(),
  };
}

const REQUEST_TOKEN_URL = "https://api.discogs.com/oauth/request_token";
const AUTHORIZE_URL = "https://www.discogs.com/oauth/authorize?oauth_token=";
const ACCESS_TOKEN_URL = "https://api.discogs.com/oauth/access_token";
const IDENTITY_URL = "https://api.discogs.com/oauth/identity";

const SETTINGS = "/settings";
const to = (value: "connected" | "denied" | "error") => ({ location: `${SETTINGS}?discogs=${value}` });

/** The app can't start a sign-in: consumer key/secret or user agent missing. The message names them, never values. */
export class ConnectSetupError extends Error {
  readonly kind = "setup";
}

class StepError extends Error {}

type Consumer = { consumerKey: string; consumerSecret: string };

function consumer(env: ConnectDeps["env"]): Consumer | null {
  const consumerKey = (env.DISCOGS_CONSUMER_KEY ?? "").trim();
  const consumerSecret = (env.DISCOGS_CONSUMER_SECRET ?? "").trim();
  if (!consumerKey || !consumerSecret || !(env.DISCOGS_USER_AGENT ?? "").trim()) return null;
  return { consumerKey, consumerSecret };
}

async function call(
  deps: ConnectDeps,
  step: string,
  method: "GET" | "POST",
  url: string,
  sign: { token?: string; tokenSecret?: string; callback?: string; verifier?: string },
  c: Consumer,
): Promise<string> {
  const authorization = oauthHeader({ method, url, ...c, ...sign, nonce: deps.nonce(), timestamp: Math.floor(deps.now() / 1000) });
  let res: Response;
  try {
    res = await deps.fetchImpl(url, {
      method,
      headers: {
        Authorization: authorization,
        "User-Agent": deps.userAgent,
        ...(method === "POST" ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
      },
      cache: "no-store",
    });
  } catch {
    throw new StepError(`${step}: network error`);
  }
  const text = await res.text().catch(() => "");
  if (!res.ok) throw new StepError(`${step}: HTTP ${res.status}`);
  return text;
}

function tokens(step: string, text: string): { token: string; secret: string } {
  try {
    return parseTokenBody(text);
  } catch {
    throw new StepError(`${step}: unexpected response`);
  }
}

function warn(e: unknown): void {
  console.warn(`Connect Discogs failed (${e instanceof StepError ? e.message : "unexpected error"}).`);
}

/** Starts a sign-in: a request token for our callback, saved pending, then the authorize URL. */
export async function startConnect(deps: ConnectDeps, host: string, proto: string | null): Promise<{ location: string }> {
  const access = discogsAccess(deps.env, null);
  if (access.kind === "token") return { location: SETTINGS };
  const c = consumer(deps.env);
  if (!c) {
    const notReady = discogsReady({ kind: "none", reason: "setup" }, deps.env);
    throw new ConnectSetupError(notReady?.message ?? "Discogs is not set up.");
  }
  try {
    const text = await call(deps, "request_token", "POST", REQUEST_TOKEN_URL, { callback: callbackUrl(host, proto) }, c);
    const { token, secret } = tokens("request_token", text);
    savePending(deps.db, token, secret, deps.now());
    return { location: AUTHORIZE_URL + encodeURIComponent(token) };
  } catch (e) {
    warn(e);
    return to("error");
  }
}

/** Finishes a sign-in from Discogs's redirect. Saves the connection only when every step succeeds. */
export async function finishConnect(deps: ConnectDeps, query: URLSearchParams): Promise<{ location: string }> {
  const now = deps.now();
  if (query.has("denied")) {
    const t = query.get("denied") || query.get("oauth_token");
    if (t) takePending(deps.db, t, now);
    return to("denied");
  }
  const requestToken = query.get("oauth_token");
  const verifier = query.get("oauth_verifier");
  if (!requestToken) return to("error");
  const pending = takePending(deps.db, requestToken, now); // used once, whatever happens next
  const c = consumer(deps.env);
  if (!pending || !verifier || !c) return to("error");
  try {
    const exchanged = await call(deps, "access_token", "POST", ACCESS_TOKEN_URL, { token: requestToken, tokenSecret: pending.secret, verifier }, c);
    const access = tokens("access_token", exchanged);
    const body = await call(deps, "identity", "GET", IDENTITY_URL, { token: access.token, tokenSecret: access.secret }, c);
    let username: unknown;
    try {
      username = (JSON.parse(body) as { username?: unknown }).username;
    } catch {
      throw new StepError("identity: unexpected response");
    }
    if (typeof username !== "string" || !username) throw new StepError("identity: no username");
    saveConnection(deps.db, { token: access.token, secret: access.secret, username, connectedAt: deps.now() });
    return to("connected");
  } catch (e) {
    warn(e);
    return to("error");
  }
}

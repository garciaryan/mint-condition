// OAuth 1.0a (RFC 5849) HMAC-SHA1 signing for the Discogs API. Pure: node:crypto only, no network, no fs, no DB.
// Nonce and timestamp are injected so tests are fixed; `newNonce` makes a fresh nonce for real calls.
import { createHmac, randomBytes } from "node:crypto";

export type OAuthParams = {
  method: "GET" | "POST";
  url: string; // may carry a query string
  consumerKey: string;
  consumerSecret: string;
  token?: string;
  tokenSecret?: string;
  callback?: string;
  verifier?: string;
  nonce: string;
  timestamp: number;
};

/** RFC 3986 percent-encoding: only A-Z a-z 0-9 - . _ ~ stay as they are. */
export function percentEncode(s: string): string {
  return encodeURIComponent(s).replace(/[!*'()]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}

/** 32 random hex characters. */
export function newNonce(): string {
  return randomBytes(16).toString("hex");
}

function decodeQueryPart(s: string): string {
  return decodeURIComponent(s.replace(/\+/g, " "));
}

function oauthFields(p: OAuthParams): [string, string][] {
  const f: [string, string][] = [
    ["oauth_consumer_key", p.consumerKey],
    ["oauth_nonce", p.nonce],
    ["oauth_signature_method", "HMAC-SHA1"],
    ["oauth_timestamp", String(p.timestamp)],
    ["oauth_version", "1.0"],
  ];
  if (p.token) f.push(["oauth_token", p.token]);
  if (p.callback) f.push(["oauth_callback", p.callback]);
  if (p.verifier) f.push(["oauth_verifier", p.verifier]);
  return f;
}

/** Signature base string: METHOD & enc(base url) & enc(sorted, encoded oauth + query parameters). */
export function signatureBaseString(p: OAuthParams): string {
  const u = new URL(p.url);
  const query: [string, string][] = [];
  if (u.search.length > 1) {
    for (const part of u.search.slice(1).split("&")) {
      if (!part) continue;
      const i = part.indexOf("=");
      query.push(i < 0 ? [decodeQueryPart(part), ""] : [decodeQueryPart(part.slice(0, i)), decodeQueryPart(part.slice(i + 1))]);
    }
  }
  const pairs = [...oauthFields(p), ...query]
    .map(([k, v]) => [percentEncode(k), percentEncode(v)] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const base = `${u.protocol}//${u.host}${u.pathname}`;
  return `${p.method}&${percentEncode(base)}&${percentEncode(pairs)}`;
}

/** The `Authorization` header value, signed. */
export function oauthHeader(p: OAuthParams): string {
  const key = `${percentEncode(p.consumerSecret)}&${percentEncode(p.tokenSecret ?? "")}`;
  const signature = createHmac("sha1", key).update(signatureBaseString(p)).digest("base64");
  const fields = [...oauthFields(p), ["oauth_signature", signature] as [string, string]];
  return "OAuth " + fields.map(([k, v]) => `${k}="${percentEncode(v)}"`).join(", ");
}

/** Reads `oauth_token` and `oauth_token_secret` from a form-encoded response; throws if either is missing. */
export function parseTokenBody(text: string): { token: string; secret: string } {
  const params = new URLSearchParams(text.trim());
  const token = params.get("oauth_token");
  const secret = params.get("oauth_token_secret");
  if (!token || !secret) throw new Error("Discogs sent an unexpected token response.");
  return { token, secret };
}

/** Where Discogs sends the person back; https except plain-http localhost. */
export function callbackUrl(host: string, proto: string | null): string {
  const scheme = proto === "http" && host.startsWith("localhost") ? "http" : "https";
  return `${scheme}://${host}/api/discogs/callback`;
}

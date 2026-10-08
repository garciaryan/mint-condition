import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  callbackUrl,
  newNonce,
  oauthHeader,
  parseTokenBody,
  percentEncode,
  signatureBaseString,
  type OAuthParams,
} from "../lib/discogs-oauth.ts";

const rfc: OAuthParams = {
  method: "POST",
  url: "http://example.com/request?b5=%3D%253D&a3=a&c%40=&a2=r%20b",
  consumerKey: "9djdj82h48djs9d2",
  consumerSecret: "j49sk3j29djd",
  token: "kkk9d7dh3k39sjv7",
  tokenSecret: "dh893hdasih9",
  nonce: "7d8f3e4a",
  timestamp: 137131201,
};

test("percentEncode follows RFC 3986", () => {
  assert.equal(percentEncode("Ladies + Gentlemen"), "Ladies%20%2B%20Gentlemen");
  assert.equal(percentEncode("!*'()"), "%21%2A%27%28%29");
  assert.equal(percentEncode("-._~"), "-._~");
});

test("base string sorts and double-encodes the query (RFC 5849 3.4.1)", () => {
  const params = [
    "a2=r%20b",
    "a3=a",
    "b5=%3D%253D",
    "c%40=",
    "oauth_consumer_key=9djdj82h48djs9d2",
    "oauth_nonce=7d8f3e4a",
    "oauth_signature_method=HMAC-SHA1",
    "oauth_timestamp=137131201",
    "oauth_token=kkk9d7dh3k39sjv7",
    "oauth_version=1.0",
  ].join("&");
  const expected = `POST&${percentEncode("http://example.com/request")}&${percentEncode(params)}`;
  assert.equal(signatureBaseString(rfc), expected);
  // %3D%253D in the normalised parameters is encoded again in the base string.
  assert.ok(signatureBaseString(rfc).includes("b5%3D%253D%25253D"));
});

test("oauth_signature is HMAC-SHA1 of the base string with the joined secrets", () => {
  const sig = createHmac("sha1", "j49sk3j29djd&dh893hdasih9").update(signatureBaseString(rfc)).digest("base64");
  const header = oauthHeader(rfc);
  const m = header.match(/oauth_signature="([^"]*)"/);
  assert.ok(m);
  assert.equal(decodeURIComponent(m[1]), sig);
  assert.ok(header.startsWith("OAuth "));
  assert.ok(!header.includes("b5") && !header.includes("a2"));
});

test("header fields are optional where they should be", () => {
  const bare = oauthHeader({ ...rfc, token: undefined, tokenSecret: undefined });
  assert.ok(bare.includes('oauth_signature_method="HMAC-SHA1"'));
  assert.ok(bare.includes('oauth_version="1.0"'));
  assert.ok(!bare.includes("oauth_token"));
  assert.ok(!bare.includes("oauth_callback"));
  assert.ok(!bare.includes("oauth_verifier"));
  const full = oauthHeader({ ...rfc, callback: "https://a.example/cb?x=1", verifier: "ver" });
  assert.ok(full.includes('oauth_callback="https%3A%2F%2Fa.example%2Fcb%3Fx%3D1"'));
  assert.ok(full.includes('oauth_verifier="ver"'));
});

test("missing token secret signs with an empty second half", () => {
  const p = { ...rfc, token: undefined, tokenSecret: undefined };
  const sig = createHmac("sha1", "j49sk3j29djd&").update(signatureBaseString(p)).digest("base64");
  assert.equal(decodeURIComponent(oauthHeader(p).match(/oauth_signature="([^"]*)"/)![1]), sig);
});

test("parseTokenBody reads token and secret, rejects anything else", () => {
  assert.deepEqual(parseTokenBody("oauth_token=t&oauth_token_secret=s&oauth_callback_confirmed=true"), {
    token: "t",
    secret: "s",
  });
  assert.throws(() => parseTokenBody("oauth_token=t"));
  assert.throws(() => parseTokenBody("<html>"));
});

test("callbackUrl is https except plain-http localhost", () => {
  assert.equal(callbackUrl("mc-groove.fly.dev", "https"), "https://mc-groove.fly.dev/api/discogs/callback");
  assert.equal(callbackUrl("records.example", null), "https://records.example/api/discogs/callback");
  assert.equal(callbackUrl("localhost:3000", "http"), "http://localhost:3000/api/discogs/callback");
  assert.equal(callbackUrl("records.example", "http"), "https://records.example/api/discogs/callback");
});

test("newNonce is 32 hex chars and varies", () => {
  assert.match(newNonce(), /^[0-9a-f]{32}$/);
  assert.notEqual(newNonce(), newNonce());
});

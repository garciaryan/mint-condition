import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("DiscogsCard has every state's copy and the forms", () => {
  const s = src("components/settings/DiscogsCard.tsx").replace(/\s+/g, " ");
  for (const t of [
    "Using a personal access token",
    "Connect your Discogs account so this app can look up records and your seller account&apos;s price suggestions. You&apos;ll approve it on discogs.com and come straight back.",
    "Connect Discogs",
    "Disconnect",
    "To remove this app&apos;s access completely, revoke it under Applications in your",
    "https://www.discogs.com/settings/applications",
    "Discogs isn&apos;t set up for this app (missing consumer key or token).",
    "This app only reads from Discogs. It doesn&apos;t list, buy or message for you.",
  ]) assert.ok(s.includes(t), t);
  assert.match(s, /method="post"\s+action="\/api\/discogs\/connect"/);
  assert.match(s, /method="post"\s+action="\/api\/discogs\/disconnect"/);
});
test("DiscogsNotice has the notices", () => {
  const s = src("components/settings/DiscogsNotice.tsx");
  for (const t of [
    "You&apos;re ready to price records.",
    "You didn&apos;t approve the connection, so nothing changed.",
    "Connecting to Discogs didn&apos;t work. Try again.",
    "Disconnected. This app no longer uses your Discogs account.",
    "Price a record",
    'role="status"',
    "replaceState",
  ]) assert.ok(s.includes(t), t);
});
test("settings page renders the card before Account", () => {
  const s = src("app/settings/page.tsx");
  assert.ok(s.includes("<DiscogsCard"));
  assert.ok(s.indexOf("<DiscogsCard") < s.indexOf('id="account-heading"'));
});
test("home and Lookup use ConnectCard", () => {
  assert.match(src("app/page.tsx"), /<ConnectCard/);
  const l = src("components/lookup/Lookup.tsx");
  assert.ok(l.includes('"not-connected"') && l.includes("<ConnectCard"));
  assert.ok(src("components/lookup/ConnectCard.tsx").includes("Connect your Discogs account to start pricing."));
});
test("lot page shows the not-connected notice", () => {
  const s = src("app/collection/[id]/page.tsx");
  assert.ok(s.includes("Not connected to Discogs: records will be priced once you connect."));
});

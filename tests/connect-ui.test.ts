import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("DiscogsSection has every state's copy and the forms", () => {
  const s = src("components/settings/DiscogsSection.tsx").replace(/\s+/g, " ");
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
test("Settings has one Account card: Discogs, then Log out only when login is on", () => {
  const page = src("app/settings/page.tsx");
  assert.match(page, /<AccountCard /);
  assert.doesNotMatch(page, /<DiscogsCard|<LogoutButton|account-heading/);
  const card = src("components/settings/AccountCard.tsx");
  assert.match(card, /className="card account"/);
  assert.match(card, /<h2 id="account-heading">Account<\/h2>/);
  assert.ok(card.indexOf("<DiscogsSection") < card.indexOf("<LogoutButton"), "Discogs comes before Log out");
  assert.match(card, /\{loggedIn && \(/);
  const section = src("components/settings/DiscogsSection.tsx");
  assert.match(section, /<h3[^>]*>Discogs<\/h3>/);
  assert.doesNotMatch(section, /className="card/, "the section has no card of its own");
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
test("Lookup's ErrorCard titles the reconnect case Reconnect Discogs", () => {
  assert.match(src("components/lookup/Lookup.tsx"), /reconnect: "Reconnect Discogs"/);
});
test("home passes connectShown so a not-connected lookup doesn't add a second ConnectCard", () => {
  assert.match(src("app/page.tsx"), /<Lookup connectShown=\{state === "not-connected"\} \/>/);
  const l = src("components/lookup/Lookup.tsx");
  assert.match(l, /export default function Lookup\(\{ connectShown = false \}/);
  assert.match(l, /view\.res\.kind === "not-connected" && !connectShown && <ConnectCard \/>/);
});

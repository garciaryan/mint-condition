import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { DATA_CREDIT, NOT_AFFILIATED, releaseUrl } from "../lib/discogs-terms.ts";

const src = (p: string) => readFileSync(p, "utf8");

test("notices use the exact wording the Discogs API terms require", () => {
  assert.equal(
    NOT_AFFILIATED,
    "This application uses Discogs’ API but is not affiliated with, sponsored or endorsed by Discogs. ‘Discogs’ is a trademark of Zink Media, LLC.",
  );
  assert.equal(DATA_CREDIT, "Data provided by Discogs");
});

test("releaseUrl links to the release page on discogs.com", () => {
  assert.equal(releaseUrl(123), "https://www.discogs.com/release/123");
});

test("every page shows the footer notice", () => {
  assert.match(src("app/layout.tsx"), /<SiteFooter \/>/);
  assert.match(src("components/layout/SiteFooter.tsx"), /NOT_AFFILIATED/);
});

test("Discogs data is credited next to it, with a followed link", () => {
  for (const f of ["components/lookup/Lookup.tsx", "components/collection/ItemRow.tsx", "app/collection/[id]/print/page.tsx"]) {
    assert.match(src(f), /DATA_CREDIT/, f);
  }
  for (const f of ["components/lookup/Lookup.tsx", "components/collection/ItemRow.tsx"]) assert.match(src(f), /releaseUrl\(/, f);
  for (const f of ["components/lookup/Lookup.tsx", "components/collection/ItemRow.tsx", "components/layout/SiteFooter.tsx"]) {
    assert.doesNotMatch(src(f), /nofollow/, f);
  }
});

test("searchUrl links the pressing list to the Discogs search for that catalog number", async () => {
  const { searchUrl } = await import("../lib/discogs-terms.ts");
  assert.equal(searchUrl("SD 7208"), "https://www.discogs.com/search/?q=SD%207208&type=release");
});

test("Discogs data older than 6 hours counts as expired", async () => {
  const { dataExpired, MAX_CACHE_HOURS } = await import("../lib/discogs-terms.ts");
  const six = MAX_CACHE_HOURS * 3_600_000;
  assert.equal(dataExpired(0, six), false);
  assert.equal(dataExpired(0, six + 1), true);
});

test("every place that shows Discogs data or numbers worked out from it carries the credit", () => {
  for (const f of [
    "components/lookup/Picker.tsx", "components/collection/TotalsBar.tsx", "components/collection/OfferPanel.tsx",
    "components/collection/LotsList.tsx", "components/collection/Scanner.tsx",
  ]) {
    assert.match(src(f), /<DiscogsCredit\b/, f);
  }
  assert.match(src("components/ui/DiscogsCredit.tsx"), /DATA_CREDIT/);
  assert.doesNotMatch(src("components/ui/DiscogsCredit.tsx"), /nofollow/);
  assert.match(src("components/lookup/Picker.tsx"), /searchUrl\(/);
  assert.match(src("app/collection/[id]/print/page.tsx"), /discogs\.com\/release\//);
});

test("the result card hides prices once they pass the 6-hour limit", () => {
  assert.match(src("components/lookup/Lookup.tsx"), /dataExpired\(/);
});

test("the demand badge (want/have from Discogs) only appears where the Discogs credit sits", () => {
  const walk = (dir: string): string[] =>
    !existsSync(dir) ? [] : readdirSync(dir).flatMap((n) => {
      const p = path.join(dir, n);
      return statSync(p).isDirectory() ? walk(p) : /\.tsx$/.test(n) ? [p] : [];
    });
  const users = ["components", "app"].flatMap(walk).filter((f) => /<DemandBadge\b/.test(src(f)));
  assert.ok(users.length > 0, "something renders the badge");
  for (const f of users) assert.match(src(f), /DATA_CREDIT|<DiscogsCredit\b/, f);
});

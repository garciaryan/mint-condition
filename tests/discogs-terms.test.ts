import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
  assert.match(src("app/SiteFooter.tsx"), /NOT_AFFILIATED/);
});

test("Discogs data is credited next to it, with a followed link", () => {
  for (const f of ["app/Lookup.tsx", "app/collection/[id]/ItemRow.tsx", "app/collection/[id]/print/page.tsx"]) {
    assert.match(src(f), /DATA_CREDIT/, f);
  }
  for (const f of ["app/Lookup.tsx", "app/collection/[id]/ItemRow.tsx"]) assert.match(src(f), /releaseUrl\(/, f);
  for (const f of ["app/Lookup.tsx", "app/collection/[id]/ItemRow.tsx", "app/SiteFooter.tsx"]) {
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
    "app/Picker.tsx", "app/collection/[id]/TotalsBar.tsx", "app/collection/[id]/OfferPanel.tsx",
    "app/collection/LotsList.tsx", "app/collection/[id]/Scanner.tsx",
  ]) {
    assert.match(src(f), /<DiscogsCredit\b/, f);
  }
  assert.match(src("app/DiscogsCredit.tsx"), /DATA_CREDIT/);
  assert.doesNotMatch(src("app/DiscogsCredit.tsx"), /nofollow/);
  assert.match(src("app/Picker.tsx"), /searchUrl\(/);
  assert.match(src("app/collection/[id]/print/page.tsx"), /discogs\.com\/release\//);
});

test("the result card hides prices once they pass the 6-hour limit", () => {
  assert.match(src("app/Lookup.tsx"), /dataExpired\(/);
});

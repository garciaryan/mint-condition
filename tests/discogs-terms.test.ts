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

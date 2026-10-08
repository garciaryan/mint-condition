import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { coverageText, displayStatus, etaText, offerNotes, offerOptionsLabel, offerSummary, pasteSummary, showsCherryPicks, wantHaveText } from "../lib/collection/ui.ts";
import { computeOffer, offerInputs } from "../lib/offer.ts";
import { parseSettings } from "../lib/settings.ts";
import type { ItemRow } from "../lib/collection/types.ts";

test("coverageText omits zero parts after priced", () => {
  assert.equal(
    coverageText({ priced: 62, total: 70, toPick: 4, noPrice: 2, problems: 1 }),
    "62 of 70 priced · 4 to pick · 2 no price · 1 error",
  );
  assert.equal(coverageText({ priced: 3, total: 3, toPick: 0, noPrice: 0, problems: 0 }), "3 of 3 priced");
  assert.equal(coverageText({ priced: 0, total: 2, toPick: 0, noPrice: 0, problems: 2 }), "0 of 2 priced · 2 error");
});

test("coverageText appends updating and couldn't refresh", () => {
  assert.equal(
    coverageText({ priced: 5, total: 7, toPick: 0, noPrice: 0, problems: 0, refreshing: 2, stale: 1 }),
    "5 of 7 priced · 2 updating · 1 couldn't refresh",
  );
  assert.equal(coverageText({ priced: 1, total: 1, toPick: 0, noPrice: 0, problems: 0, refreshing: 0, stale: 0 }), "1 of 1 priced");
});

test("displayStatus shows a no-price row with a value as priced", () => {
  assert.equal(displayStatus({ status: "no-price", market: { suggested: 1 } }), "priced");
  assert.equal(displayStatus({ status: "no-price", market: null }), "no-price");
  assert.equal(displayStatus({ status: "error", market: { suggested: 1 } }), "error");
});

test("etaText formats seconds and minutes", () => {
  assert.equal(etaText(5), "5 sec");
  assert.equal(etaText(59), "59 sec");
  assert.equal(etaText(120), "2 min");
  assert.equal(etaText(0), "1 sec");
});

test("pasteSummary lists skipped lines", () => {
  assert.equal(pasteSummary(23, []), "23 records");
  assert.equal(pasteSummary(1, [4]), "1 record, 1 line skipped: line 4");
  assert.equal(pasteSummary(5, [2, 3]), "5 records, 2 lines skipped: lines 2, 3");
  assert.equal(pasteSummary(5, [1, 2, 3, 4, 5, 6]), "5 records, 6 lines skipped: lines 1, 2, 3, 4, 5, …");
});

import { createSerialQueue } from "../lib/collection/ui.ts";

test("createSerialQueue runs jobs one at a time, in order, and survives rejection", async () => {
  const enqueue = createSerialQueue();
  const log: string[] = [];
  let running = 0;
  let maxRunning = 0;
  const job = (name: string, ms: number, fail = false) => async () => {
    running++;
    maxRunning = Math.max(maxRunning, running);
    log.push(`start ${name}`);
    await new Promise((r) => setTimeout(r, ms));
    running--;
    log.push(`end ${name}`);
    if (fail) throw new Error(name);
    return name;
  };
  const results = await Promise.allSettled([enqueue(job("a", 30)), enqueue(job("b", 1, true)), enqueue(job("c", 1))]);
  assert.equal(maxRunning, 1);
  assert.deepEqual(log, ["start a", "end a", "start b", "end b", "start c", "end c"]);
  assert.deepEqual(results.map((r) => r.status), ["fulfilled", "rejected", "fulfilled"]);
});

import { STATUS_INFO } from "../lib/collection/ui.ts";
test("STATUS_INFO covers every item status with text", () => {
  for (const k of ["pending", "looking-up", "to-pick", "priced", "no-match", "no-price", "error"] as const) {
    assert.ok(STATUS_INFO[k].text.length > 0);
  }
  assert.equal(STATUS_INFO.priced.text, "Priced");
});

const settings = parseSettings(JSON.parse(readFileSync("settings.json", "utf8")));
const row = (o: Partial<ItemRow>): ItemRow => ({
  id: 1, sessionId: 1, query: "Q", year: null, record: "VG+", sleeve: "NM", status: "pending", releaseId: null,
  release: null, candidates: null, suggestions: null, stats: null, pricedAt: null, error: null, createdAt: 0,
  pick: null, refresh: false, notes: "", ...o,
});
const stats = { lowestPrice: 12, currency: "USD", numForSale: 3 };
const lot = [
  row({ status: "priced", suggestions: { NM: 40, "VG+": 30, VG: 20 }, stats }),
  row({ status: "priced", suggestions: { NM: 12, "VG+": 10, VG: 6 }, stats }),
  row({}),
];
const inputs = offerInputs({ unverified: false, pickThreshold: null, bulkEach: null, lotOverhead: 0 }, settings);

test("offerSummary shows the whole-lot opening rung and walk-away", () => {
  assert.equal(offerSummary(computeOffer(lot, inputs, settings), "USD"), "Offer · open $13 · max $18");
});

test("offerNotes lists only the notes that apply", () => {
  assert.deepEqual(offerNotes(computeOffer(lot, inputs, settings), "USD"), ["1 record unpriced, counted as bulk at $0.50 each"]);
  const o = computeOffer([row({}), row({})], { ...inputs, unverified: true }, settings);
  assert.deepEqual(offerNotes(o, "USD"), [
    "2 records unpriced, counted as bulk at $0.50 each",
    "Grades lowered 1 step for this offer (condition unverified)",
    "Picks: none at or above $15",
  ]);
});

test("phone rows: stacked grades, and status + actions share a wrapping foot line (no overlap, price column stays narrow)", () => {
  const css = readFileSync("app/globals.css", "utf8");
  const phone = css.slice(css.indexOf("@media (max-width: 480px)"));
  assert.match(css, /\.row-foot \{\s*display: contents;\s*\}/, "the foot wrapper is invisible to the desktop grid");
  assert.match(phone, /\.row \{[^}]*grid-template-areas:\s*"title title"\s*"thumb meta"\s*"price price"\s*"grades grades"\s*"foot foot";/);
  assert.match(phone, /\.row-foot \{[^}]*grid-area: foot;[^}]*display: flex;[^}]*flex-wrap: wrap;[^}]*justify-content: space-between;/);
  assert.match(phone, /\.row-grades \{[^}]*grid-area: grades;[^}]*flex-direction: column;[^}]*gap: 12px;/);
  assert.match(phone, /\.row-actions \{[^}]*flex-wrap: wrap;[^}]*justify-content: flex-end;/);
});

test("the note button is a pencil icon on phones and text on wider screens", () => {
  const css = readFileSync("app/globals.css", "utf8");
  const phone = css.slice(css.indexOf("@media (max-width: 480px)"));
  assert.match(css, /\.note-btn \.icon \{\s*display: none;\s*\}/);
  assert.match(phone, /\.note-btn \.icon \{[^}]*display: block;/);
  assert.match(phone, /\.note-btn \.note-label \{[^}]*clip: rect\(0, 0, 0, 0\);/);
  assert.match(phone, /\.note-btn\.has-note \{[^}]*background: var\(--/);
});

test("note chips get a hover state, and an over-limit note count turns red", () => {
  const css = readFileSync("app/globals.css", "utf8");
  assert.match(css, /@media \(hover: hover\) \{\s*\.note-chip:hover:not\(:disabled\) \{[^}]*background: var\(--/);
  assert.match(css, /\.note-count\.over \{[^}]*color: var\(--danger\);/);
});

test("phone rows: the title gets a full-width line, the star sits top-right, and the price gets its own line", () => {
  const css = readFileSync("app/globals.css", "utf8");
  const phone = css.slice(css.indexOf("@media (max-width: 480px)"));
  assert.match(phone, /\.row-main \{\s*display: contents;\s*\}/, "title and details become separate grid items");
  assert.match(phone, /\.row \.title \{[^}]*grid-area: title;[^}]*padding-right: /, "the title keeps clear of the star");
  assert.match(phone, /\.row-meta \{[^}]*grid-area: meta;/);
  assert.match(phone, /\.row \{[^}]*position: relative;/);
  assert.match(phone, /\.row \.star \{[^}]*position: absolute;[^}]*top: [^}]*right: [^}]*width: var\(--control-h\);/);
  assert.match(phone, /\.row-price \{[^}]*grid-area: price;[^}]*justify-content: flex-start;[^}]*text-align: left;/);
});

test("phone rows show a labelled, padded Market value box; wider screens keep the compact price cell", () => {
  const css = readFileSync("app/globals.css", "utf8");
  const phone = css.slice(css.indexOf("@media (max-width: 480px)"));
  assert.match(css, /\.row-market \{\s*display: none;\s*\}/, "hidden outside phones");
  assert.match(phone, /\.row-market \{[^}]*display: block;[^}]*flex: 1;[^}]*margin: 6px 0;[^}]*padding: /);
  assert.match(phone, /\.row-price \.row-value \{\s*display: none;\s*\}/, "the compact cell is hidden on phones");
  assert.match(css, /\.row-market-title \{[^}]*text-transform: uppercase;[^}]*color: var\(--muted\);/);
  const row = readFileSync("components/collection/ItemRow.tsx", "utf8");
  assert.match(row, /className="price-block row-market"/);
  assert.match(row, /<small>Low<\/small>[\s\S]*<small>Suggested<\/small>[\s\S]*<small>High<\/small>/);
  assert.match(row, /Market value/);
});

test("demand badges use the status pill tokens: fast like Priced, slow like To pick", () => {
  const css = readFileSync("app/globals.css", "utf8");
  assert.match(css, /\.demand\.fast \{[^}]*color: var\(--accent\);[^}]*background: var\(--accent-soft\);/);
  assert.match(css, /\.demand\.slow \{[^}]*color: var\(--warn\);[^}]*background: var\(--notice-bg\);[^}]*border: 1px solid var\(--warn-line\);/);
});

test("coverageText counts slow sellers", () => {
  assert.equal(coverageText({ priced: 5, total: 6, toPick: 1, noPrice: 0, problems: 0, slow: 2 }), "5 of 6 priced · 1 to pick · 2 slow");
  assert.equal(coverageText({ priced: 5, total: 5, toPick: 0, noPrice: 0, problems: 0, slow: 0 }), "5 of 5 priced");
});

test("offer notes say when slow sellers are left out of picks", () => {
  const slow = row({ status: "priced", suggestions: { NM: 40, "VG+": 30, VG: 20 }, stats: { lowestPrice: 1, currency: null, numForSale: 50, have: 100, want: 10 } });
  const on = offerInputs({ unverified: false, pickThreshold: null, bulkEach: null, lotOverhead: 0, skipSlow: true }, settings);
  assert.deepEqual(offerNotes(computeOffer([slow], on, settings), "USD"), [
    "Slow sellers left out of cherry-picks",
    "Picks: none at or above $15 once slow sellers are left out",
  ]);
  const off = offerInputs({ unverified: false, pickThreshold: null, bulkEach: null, lotOverhead: 0 }, settings);
  assert.deepEqual(offerNotes(computeOffer([slow], off, settings), "USD"), []);
});

test("wantHaveText gives lot rows a visible want/have line whenever Discogs sent the counts", () => {
  assert.equal(wantHaveText({ want: 3357, have: 878 }), "3,357 want · 878 have");
  assert.equal(wantHaveText({ want: 0, have: 5 }), "0 want · 5 have");
  assert.equal(wantHaveText({}), null);
  assert.match(readFileSync("components/collection/ItemRow.tsx", "utf8"), /wantHaveText\(item\)/);
});

test("the buy sheet explains a missing star when slow sellers are left out of picks", () => {
  const sheet = readFileSync("app/collection/[id]/print/page.tsx", "utf8");
  assert.match(sheet, /\{lot\.skipSlow && <p>★ leaves out slow sellers, so a record above the pick threshold can be without a star\.<\/p>\}/);
});

test("the demand badge gives its counts once (screen-reader text, no title tooltip)", () => {
  const badge = readFileSync("components/ui/DemandBadge.tsx", "utf8");
  assert.doesNotMatch(badge, /title=/);
  assert.match(badge, /className="sr-only"/);
});

test("offerOptionsLabel says how many offer options are on", () => {
  assert.equal(offerOptionsLabel(false, false), "Options");
  assert.equal(offerOptionsLabel(true, false), "Options · 1 on");
  assert.equal(offerOptionsLabel(false, true), "Options · 1 on");
  assert.equal(offerOptionsLabel(true, true), "Options · 2 on");
});

test("offer inputs: Options on the left and the inputs to the right on desktop; an even two-column grid on phones", () => {
  const css = readFileSync("app/globals.css", "utf8");
  const phone = css.slice(css.indexOf("@media (max-width: 480px)"));
  assert.match(css, /\.offer-inputs \{[^}]*display: flex;[^}]*align-items: flex-end;/, "button lines up with the input boxes");
  assert.match(css, /\.offer-inputs > \.dropdown \{[^}]*margin-right: auto;/, "Options left, inputs pushed right");
  assert.match(css, /\.offer-inputs > \.dropdown > button \{[^}]*min-height: var\(--control-h\);/);
  assert.match(phone, /\.offer-inputs \{[^}]*display: grid;[^}]*grid-template-columns: 1fr 1fr;/);
  assert.match(phone, /\.offer-inputs > \.dropdown > button \{[^}]*width: 100%;/);
});

test("offer option rows have their own class, so the input widths don't squeeze them", () => {
  const panel = readFileSync("components/collection/OfferPanel.tsx", "utf8");
  assert.match(panel, /className="offer-option"/);
  assert.doesNotMatch(panel.slice(panel.indexOf('id="offer-options"')), /^[^]*?className="field inline switch"[^]*?<\/div>\s*\)\}/);
  const css = readFileSync("app/globals.css", "utf8");
  assert.match(css, /\.offer-option \{[^}]*min-height: var\(--control-h\);/);
});

test("on phones the open Options panel spans both input columns, so its labels have room", () => {
  const css = readFileSync("app/globals.css", "utf8");
  const phone = css.slice(css.indexOf("@media (max-width: 480px)"));
  assert.match(phone, /\.offer-inputs \{[^}]*column-gap: 16px;/);
  assert.match(phone, /\.offer-options \{[^}]*min-width: 0;[^}]*width: calc\(200% \+ 16px\);[^}]*max-width: calc\(100vw - 2 \* var\(--gutter\)\);/);
});

test("the cherry-pick ladder shows only when some records are picks and some aren't", () => {
  const pick = row({ status: "priced", suggestions: { NM: 40, "VG+": 30, VG: 20 } });
  const cheap = row({ status: "priced", suggestions: { NM: 4, "VG+": 3, VG: 2 } });
  const inputs = offerInputs({ unverified: false, pickThreshold: null, bulkEach: null, lotOverhead: 0 }, settings);
  assert.equal(showsCherryPicks(computeOffer([pick, cheap], inputs, settings)), true);
  assert.equal(showsCherryPicks(computeOffer([pick, pick], inputs, settings)), false, "all picks");
  assert.equal(showsCherryPicks(computeOffer([cheap, cheap], inputs, settings)), false, "no picks");
  assert.equal(showsCherryPicks(computeOffer([], inputs, settings)), false, "empty");
  for (const f of ["components/collection/OfferPanel.tsx", "app/collection/[id]/print/page.tsx"]) {
    assert.match(readFileSync(f, "utf8"), /showsCherryPicks\(offer\) && \(?\s*<Ladder caption=\{`Cherry-picks/, f);
  }
});

test("the Options button is as wide as the offer inputs on desktop", () => {
  const css = readFileSync("app/globals.css", "utf8");
  // Top-level (desktop) rules start at column 0; the phone overrides are indented inside their @media block.
  const field = css.match(/^\.offer-inputs \.field \{[^}]*width: (\d+px);/m)?.[1];
  assert.ok(field, "offer input width");
  assert.match(css, new RegExp(`^\\.offer-inputs > \\.dropdown > button \\{[^}]*width: ${field};`, "m"));
});

test("runout matches are marked with tokens; the small Show runouts checkbox sits under the listing (44px on phones)", () => {
  const css = readFileSync("app/globals.css", "utf8");
  const phone = css.slice(css.indexOf("@media (max-width: 480px)"));
  assert.match(css, /\.runout-hit \{[^}]*background: var\(--accent-soft\);[^}]*color: var\(--ink\);/);
  assert.match(css, /\.runout-show \{[^}]*font-size: 13px;/);
  assert.match(phone, /\.runout-show \{[^}]*min-height: var\(--control-h\);/);
  const picker = readFileSync("components/lookup/Picker.tsx", "utf8");
  assert.match(picker, /<label className="runout-show">\s*<input\s+type="checkbox"/);
  assert.match(picker, /Show runouts<span className="sr-only"> for \{c\.title\}<\/span>/);
  assert.doesNotMatch(picker, /runout-toggle|candidate-row/, "no button beside the title any more");
});

test("the Picker keeps failed pressings in sight while searching and lets one click collapse an auto-opened row", () => {
  const picker = readFileSync("components/lookup/Picker.tsx", "utf8");
  assert.match(picker, /searchVisible\(/);
  assert.match(picker, /isExpanded\(/);
  assert.match(picker, /toggleExpanded\(/);
  assert.match(picker, /runoutCounts\(/);
  assert.doesNotMatch(picker, /type RunoutState =/, "one RunoutState, from lib/runout.ts");
});

import { pausedText, queueLine } from "../lib/collection/ui.ts";
test("queueLine: looking up with a spinner, paused, or waiting for a Discogs connection without one", () => {
  const q = { pending: 3, paused: false, etaSeconds: 10 };
  assert.deepEqual(queueLine(q, "connected"), { text: "Looking up · 3 left · ~10 sec", spinner: true });
  assert.deepEqual(queueLine({ ...q, paused: true }, "token"), { text: "Paused · 3 waiting", spinner: false });
  assert.deepEqual(queueLine(q, "not-connected"), { text: "Waiting for Discogs connection · 3 left", spinner: false });
  assert.equal(queueLine({ ...q, pending: 0 }, "connected"), null);
});
test("pausedText: token mode says fix the token; an OAuth app says reconnect", () => {
  assert.equal(pausedText("token"), "Discogs rejected the token. Fix the token, then press Retry.");
  for (const s of ["connected", "not-connected", "setup"] as const)
    assert.equal(pausedText(s), "Discogs no longer accepts this app's access. Reconnect Discogs in Settings, then press Retry.");
});
test("lot page passes the Discogs state through LotView to TotalsBar", () => {
  const page = readFileSync(new URL("../app/collection/[id]/page.tsx", import.meta.url), "utf8");
  assert.match(page, /<LotView[^>]*discogs=\{state\}/);
  const lot = readFileSync(new URL("../components/collection/LotView.tsx", import.meta.url), "utf8");
  assert.match(lot, /<TotalsBar[^>]*discogs=\{discogs\}/);
  const bar = readFileSync(new URL("../components/collection/TotalsBar.tsx", import.meta.url), "utf8");
  assert.ok(bar.includes("queueLine(") && bar.includes("pausedText("));
  assert.ok(!bar.includes("Fix the token"));
});

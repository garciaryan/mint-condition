// CLI: npm run lookup -- <catno|barcode> <year> <recordGrade> <sleeveGrade> [areaCode] [--id <releaseId>]
// Reads DISCOGS_TOKEN and DISCOGS_USER_AGENT from .env.local (loaded by the npm script).
import { DiscogsClient } from "../lib/discogs.ts";
import { priceRecord } from "../lib/pricing.ts";
import { loadSettings } from "../lib/settings.ts";
import { isGrade } from "../lib/types.ts";

function fail(message: string, code: number): never {
  console.error(message);
  process.exit(code);
  throw new Error(message); // unreachable; keeps the return type honest
}

const args = process.argv.slice(2);
const idFlag = args.indexOf("--id");
let forcedId: number | undefined;
if (idFlag !== -1) {
  forcedId = Number(args[idFlag + 1]);
  args.splice(idFlag, 2);
}
const [catno, yearArg, recordArg, sleeveArg, areaCode] = args;

if (!catno || !yearArg || !recordArg || !sleeveArg) {
  fail("Usage: npm run lookup -- <catno|barcode> <year> <recordGrade> <sleeveGrade> [areaCode] [--id <releaseId>]\nGrades: M NM VG+ VG G+ G F P", 1);
}
if (!isGrade(recordArg) || !isGrade(sleeveArg)) {
  fail("Invalid grade. Use one of: M NM VG+ VG G+ G F P", 1);
}

const settings = loadSettings();
const client = new DiscogsClient({
  token: process.env.DISCOGS_TOKEN ?? "",
  userAgent: process.env.DISCOGS_USER_AGENT ?? "",
});

let releaseId = forcedId;
if (releaseId === undefined) {
  const candidates = await client.searchByCatno(catno, Number(yearArg));
  if (candidates.length === 0) {
    fail("No releases found. Try a different catalog number format or widen the year.", 2);
  }
  if (candidates.length > 1) {
    console.log(`${candidates.length} possible pressings. Re-run with --id <id> to choose one:\n`);
    for (const c of candidates) {
      console.log(`${String(c.id).padEnd(10)} ${c.year ?? "----"}  ${c.country ?? "--"}  ${c.title}  [${c.label ?? ""} ${c.catno ?? ""}] ${c.format ?? ""}`);
    }
    process.exit(0);
  }
  releaseId = candidates[0].id;
  console.log(`Matched: ${candidates[0].title} (${candidates[0].year}, ${candidates[0].country}) id ${releaseId}`);
}

const [suggestions, stats] = await Promise.all([client.priceSuggestions(releaseId), client.marketplaceStats(releaseId)]);
if (!suggestions) {
  fail("No price suggestions for this release (none exist, or the seller account isn't set up).", 3);
}

const result = priceRecord({
  suggestions,
  lowestListing: stats.lowestPrice,
  record: recordArg,
  sleeve: sleeveArg,
  areaCode,
  settings,
});
if (!result) {
  fail(`Discogs has no suggestion for grade ${recordArg}.`, 3);
}

const cur = stats.currency ?? settings.discogs.currency;
console.log(`\nFor sale on Discogs: ${stats.numForSale}, lowest listing: ${stats.lowestPrice ?? "n/a"} ${cur}`);
console.log(`Market value : ${result.market.low} - ${result.market.suggested} - ${result.market.high} ${cur} (low / suggested / high)`);
console.log(`Sell price   : ${result.sell.price} ${cur}${result.sell.aboveLowestListing ? "  (above the cheapest current listing)" : ""}`);
console.log(`Local sale   : ${result.local.price} ${cur} (region x${result.local.regionMultiplier}); Discogs net after fee: ${result.local.discogsNet}`);

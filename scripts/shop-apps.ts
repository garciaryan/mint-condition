// Prints the shop apps to deploy (JSON) from the FLY_SHOP_APPS repo variable, checked against lib/shops.ts. Run by the
// deploy workflow's image job, before anything deploys; a bad value fails the run there.
import { readFileSync } from "node:fs";
import { parseAppName } from "../lib/setup-fly.ts";
import { parseShopApps } from "../lib/shops.ts";

try {
  const canary = parseAppName(readFileSync(new URL("../fly.toml", import.meta.url), "utf8")) ?? "";
  console.log(JSON.stringify(parseShopApps(process.env.FLY_SHOP_APPS, canary)));
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
}

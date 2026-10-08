// Prints the tag for this deploy (vx.y.z-alpha.N) from package.json's version and the repo's tags. Run by the deploy
// job in .github/workflows/fly-deploy.yml, which needs the tags fetched (fetch-depth: 0).
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { nextAlphaTag } from "../lib/version.ts";

const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
const tags = execFileSync("git", ["tag", "--list", "v*"], { encoding: "utf8" }).split("\n").filter(Boolean);
console.log(nextAlphaTag(version, tags));

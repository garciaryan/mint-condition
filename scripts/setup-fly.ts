// npm run setup:fly — sets this app's Fly secrets (Discogs token, User-Agent, login password) without typing
// `fly secrets`. Values go to `fly secrets import` on stdin, so they never reach shell history, `ps`, or a file.
// Re-run it to change the password or token; Enter keeps whatever is already set.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { defaultUserAgent, parseAppName, parseSecretNames, passwordError, planSecrets, secretValueError } from "../lib/setup-fly.ts";
import type { Answers } from "../lib/setup-fly.ts";
import { ask, closePrompt } from "./prompt.ts";

function fail(message: string): never {
  closePrompt();
  console.error(message);
  process.exit(1);
}

// No shell: args are passed as an array, and only the import gets stdin.
function run(bin: string, args: string[], input?: string) {
  return spawnSync(bin, args, input === undefined ? { encoding: "utf8" } : { input, encoding: "utf8", stdio: ["pipe", "inherit", "inherit"] });
}

if (!process.stdin.isTTY) fail("Run this in a terminal.");

const bin = ["fly", "flyctl"].find((b) => !run(b, ["version"]).error);
if (!bin) fail("Install flyctl first: https://fly.io/docs/flyctl/install/");
if (run(bin, ["auth", "whoami"]).status !== 0) fail("Log in first: fly auth login");

let toml = "";
try {
  toml = readFileSync("fly.toml", "utf8");
} catch {}
const app = parseAppName(toml);
if (!app) fail("Create the app first: fly launch --copy-config --no-deploy");

const listed = run(bin, ["secrets", "list", "-a", app, "--json"]);
if (listed.status !== 0) fail(`Could not read the secrets of ${app}. Is the app name in fly.toml right?`);
const current = parseSecretNames(listed.stdout);
const has = (name: string) => current.includes(name);

console.log(`Setting secrets for ${app}. Typing is hidden for the token and password.\n`);

/** Asks until the answer passes `check`; Enter returns undefined (keep) when something is already set. */
async function prompt(question: string, keep: boolean, hidden: boolean, check: (v: string) => string | null): Promise<string | undefined> {
  for (;;) {
    const v = (await ask(`${question}${keep ? " (Enter keeps the current one)" : ""}: `, { hidden })).trim();
    if (!v && keep) return undefined;
    if (!v) {
      console.log("Required.");
      continue;
    }
    const problem = check(v);
    if (!problem) return v;
    console.log(problem);
  }
}

const answers: Answers = {};
answers.token = await prompt("Discogs personal access token", has("DISCOGS_TOKEN"), true, secretValueError);
const contact = await prompt("Contact for the Discogs User-Agent (email or URL)", has("DISCOGS_USER_AGENT"), false, (v) =>
  secretValueError(defaultUserAgent(v)),
);
if (contact !== undefined) answers.userAgent = defaultUserAgent(contact);

const keepPassword = has("APP_PASSWORD") || has("APP_PASSWORD_HASH");
for (;;) {
  const first = await prompt("Login password (min 12 characters)", keepPassword, true, () => null);
  if (first === undefined) break;
  const problem = passwordError(first, await ask("Repeat password: ", { hidden: true }));
  if (!problem) {
    answers.password = first;
    break;
  }
  console.log(problem);
}
closePrompt();

const plan = planSecrets(current, answers);
if (!plan.set.length) {
  console.log("Nothing changed.");
  process.exit(0);
}

if (run(bin, ["secrets", "import", "-a", app], plan.importText).status !== 0) fail("fly secrets import failed; nothing else was changed.");
console.log(`Set: ${plan.set.join(", ")}`);
if (plan.unset.length) {
  if (run(bin, ["secrets", "unset", ...plan.unset, "-a", app]).status !== 0) fail(`Could not remove ${plan.unset.join(", ")}; remove it with fly secrets unset.`);
  console.log(`Removed: ${plan.unset.join(", ")}`);
}
console.log("Next: fly deploy --ha=false (first deploy only; setting secrets restarts a running app).");

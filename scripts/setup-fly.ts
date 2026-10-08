// npm run setup:fly — sets this app's Fly secrets (Discogs token, User-Agent, login password) without typing
// `fly secrets`. `npm run setup:fly -- --app mc-<shop>` sets a shop's app instead of the one in fly.toml. Values go to `fly secrets import` on stdin, so they never reach shell history, `ps`, or a file.
// Re-run it to change the password or token; Enter keeps whatever is already set.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { appFromArgs, defaultUserAgent, flyCommands, parseSecretNames, passwordError, planSecrets, secretValueError } from "../lib/setup-fly.ts";
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
let app = "";
try {
  app = appFromArgs(process.argv.slice(2), toml);
} catch (e) {
  fail(e instanceof Error ? e.message : String(e));
}

const listed = run(bin, ["secrets", "list", "-a", app, "--json"]);
if (listed.status !== 0) fail(`Could not read the secrets of ${app}. Is the app name right?`);
const current = parseSecretNames(listed.stdout);
const has = (name: string) => current.includes(name);

console.log(`Setting secrets for ${app}. Typing is hidden for the keys, token and password.\n`);

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
const isShop = process.argv.slice(2).includes("--app");
if (isShop) {
  // A shop connects its own Discogs account in the app (Connect Discogs), through the owner's registered application.
  answers.consumerKey = await prompt("Discogs consumer key", has("DISCOGS_CONSUMER_KEY"), true, secretValueError);
  answers.consumerSecret = await prompt("Discogs consumer secret", has("DISCOGS_CONSUMER_SECRET"), true, secretValueError);
} else {
  answers.token = await prompt("Discogs personal access token", has("DISCOGS_TOKEN"), true, secretValueError);
}
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

for (const args of flyCommands(app, plan)) {
  const input = args[1] === "import" ? plan.importText : undefined;
  if (run(bin, args, input).status !== 0) {
    fail(
      args[1] === "import"
        ? "fly secrets import failed. Nothing was applied; the app keeps its current secrets."
        : args[1] === "unset"
          ? // APP_PASSWORD is staged; the next deploy would apply it next to the old hash (a 503). Finish the swap.
            `Could not remove the old password hash. Before the next deploy, run:\n  fly secrets unset ${plan.unset.join(" ")} -a ${app} --stage\n  fly secrets deploy -a ${app}`
          : `fly secrets deploy failed. Your changes are staged: run fly secrets deploy -a ${app} to apply them.`,
    );
  }
}
console.log(`Set: ${plan.set.join(", ")}`);
if (plan.unset.length) console.log(`Removed: ${plan.unset.join(", ")}`);
console.log(
  isShop
    ? `Next: first deploy by image (DEPLOY.md section 10; setting secrets restarts a running app), then log in and press Connect Discogs on /settings.`
    : "Next: fly deploy --ha=false (first deploy only; setting secrets restarts a running app).",
);

// Session secret for self-hosters who only set a password: made once on the data volume and reused, so sessions
// survive restarts and deploys. SESSION_SECRET in the environment always wins. Server-side only (runs at boot).
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

type Env = Record<string, string | undefined>;

const blank = (v: string | undefined) => !v || !v.trim();

/** Fills env.SESSION_SECRET from `<dataDir>/session-secret` (creating it if needed) when a password is set and no
 * secret is. Returns where the secret comes from, or null when login is off. */
export function ensureSessionSecret(env: Env, dataDir: string): "env" | "file" | null {
  if (blank(env.APP_PASSWORD) && blank(env.APP_PASSWORD_HASH)) return null;
  if (!blank(env.SESSION_SECRET)) return "env";

  const file = path.join(dataDir, "session-secret");
  mkdirSync(dataDir, { recursive: true });
  try {
    writeFileSync(file, randomBytes(32).toString("base64"), { flag: "wx", mode: 0o600 });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
  }
  const secret = readFileSync(file, "utf8").trim();
  // Never quietly make a new one: that would sign everyone out with no explanation.
  if (!secret) throw new Error(`${file} is empty; delete it to make a new one (this signs everyone out).`);
  env.SESSION_SECRET = secret;
  env.SESSION_SECRET_SOURCE = "file";
  return "file";
}

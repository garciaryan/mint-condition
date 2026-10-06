// Pure parts of `npm run setup:fly` (scripts/setup-fly.ts): reading fly.toml and the secret list, checking what was
// typed, and building the `fly secrets import` input. Never logs or returns a value except inside importText.
import { MIN_PASSWORD_CHARS } from "./auth.ts";

export type Answers = { token?: string; userAgent?: string; password?: string };

export function parseAppName(flyToml: string): string | null {
  return /^app\s*=\s*["']([^"']+)["']/m.exec(flyToml)?.[1] ?? null;
}

/** Names from `fly secrets list --json` (flyctl has used both Name and name). */
export function parseSecretNames(json: string): string[] {
  try {
    const items: unknown = JSON.parse(json);
    if (!Array.isArray(items)) return [];
    return items.map((i) => (i as { Name?: string; name?: string }).Name ?? (i as { name?: string }).name).filter((n): n is string => !!n);
  } catch {
    return [];
  }
}

/** The import format is one NAME=VALUE per line and may strip surrounding quotes, so both are refused up front. */
export function secretValueError(value: string): string | null {
  if (/[\r\n]/.test(value)) return "Must be one line.";
  if (/^["']|["']$/.test(value)) return "Can't start or end with a quote.";
  return null;
}

export function passwordError(first: string, second: string): string | null {
  if (first !== second) return "Passwords do not match.";
  if (first.length < MIN_PASSWORD_CHARS) return `Password must be at least ${MIN_PASSWORD_CHARS} characters.`;
  return secretValueError(first);
}

export function defaultUserAgent(contact: string): string {
  return `MintCondition/0.1 (+${contact})`;
}

/** Undefined answers keep the current secret. A new APP_PASSWORD replaces an old APP_PASSWORD_HASH (both set is an
 * error at boot). */
export function planSecrets(current: string[], answers: Answers): { importText: string; set: string[]; unset: string[] } {
  const pairs: [string, string | undefined][] = [
    ["DISCOGS_TOKEN", answers.token],
    ["DISCOGS_USER_AGENT", answers.userAgent],
    ["APP_PASSWORD", answers.password],
  ];
  const chosen = pairs.filter((p): p is [string, string] => p[1] !== undefined);
  return {
    importText: chosen.map(([k, v]) => `${k}=${v}\n`).join(""),
    set: chosen.map(([k]) => k),
    unset: answers.password !== undefined && current.includes("APP_PASSWORD_HASH") ? ["APP_PASSWORD_HASH"] : [],
  };
}

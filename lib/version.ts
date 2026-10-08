// Version tags for deploys: each successful deploy of base x.y.z (package.json) is tagged vx.y.z-alpha.N, N counting
// up from 1. Pure apart from reading the env passed in. The tag reaches the app at build time (APP_VERSION build arg →
// NEXT_PUBLIC_APP_VERSION, see Dockerfile); local builds are "dev".
import { LINKS } from "./consts.ts";

/** The tag the next deploy of `base` gets: one past the highest vbase-alpha.N in `tags`. */
export function nextAlphaTag(base: string, tags: string[]): string {
  if (!/^\d+\.\d+\.\d+$/.test(base)) throw new Error(`package.json version must be x.y.z, got "${base}"`);
  const prefix = `v${base}-alpha.`;
  let max = 0;
  for (const t of tags) {
    if (!t.startsWith(prefix)) continue;
    const n = t.slice(prefix.length);
    if (/^\d+$/.test(n)) max = Math.max(max, Number(n));
  }
  return `${prefix}${max + 1}`;
}

export function appVersion(env: Record<string, string | undefined>): string {
  return env.NEXT_PUBLIC_APP_VERSION?.trim() || "dev";
}

/** The GitHub release for a tagged build; null for dev builds. */
export function versionUrl(version: string): string | null {
  return version === "dev" ? null : `${LINKS.repo}/releases/tag/${version}`;
}

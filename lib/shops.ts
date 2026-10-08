// The shop apps the deploy workflow ships to after the canary, from the repo variable FLY_SHOP_APPS (a JSON list of
// { app, token }: the Fly app and the name of the repo secret holding its deploy token). Checked before anything
// deploys, so a typo stops the run with a message instead of half-deploying. Pure.

export type ShopApp = { app: string; token: string };

const FLY_APP = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;
const SECRET = /^[A-Z][A-Z0-9_]*$/;

/** Fly app names: lowercase letters, digits and dashes, 3–63 long, no dash at either end. */
export function isFlyAppName(name: string): boolean {
  return FLY_APP.test(name);
}

export function parseShopApps(raw: string | undefined, canary: string): ShopApp[] {
  if (!raw?.trim()) return [];
  let list: unknown;
  try {
    list = JSON.parse(raw);
  } catch {
    throw new Error("FLY_SHOP_APPS isn't valid JSON.");
  }
  if (!Array.isArray(list)) throw new Error('FLY_SHOP_APPS must be a JSON array of {"app", "token"}.');
  const seen = new Set<string>();
  return list.map((entry: unknown, i): ShopApp => {
    const at = `FLY_SHOP_APPS[${i}]`;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error(`${at} must be an object with "app" and "token".`);
    const extra = Object.keys(entry).find((k) => k !== "app" && k !== "token");
    if (extra) throw new Error(`${at} has an unknown key "${extra}".`);
    const { app, token } = entry as Record<string, unknown>;
    if (typeof app !== "string" || !isFlyAppName(app)) throw new Error(`${at}.app "${String(app)}" isn't a valid Fly app name.`);
    if (typeof token !== "string" || !SECRET.test(token)) throw new Error(`${at}.token "${String(token)}" isn't a valid secret name.`);
    if (token.startsWith("GITHUB_")) throw new Error(`${at}.token can't start with GITHUB_ (GitHub reserves it).`);
    if (app === canary) throw new Error(`${at}.app "${app}" is the canary; it deploys before the shops already.`);
    if (seen.has(app)) throw new Error(`${at}.app "${app}" is listed twice.`);
    seen.add(app);
    return { app, token };
  });
}

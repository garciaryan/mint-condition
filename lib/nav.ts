// Sidebar state: expanded by default; collapsing is remembered in a cookie the server reads, so the page never jumps
// on load. Phones show a bottom tab bar instead and ignore it. Pure and client-safe.

export const NAV_COOKIE = "mc_nav";

/** True when the sidebar was collapsed. */
export function parseNavCookie(value: string | undefined): boolean {
  return value === "collapsed";
}

/** document.cookie string that remembers a collapsed sidebar for a year, or clears it when expanded. */
export function navCookie(collapsed: boolean): string {
  return collapsed
    ? `${NAV_COOKIE}=collapsed; Path=/; Max-Age=31536000; SameSite=Lax`
    : `${NAV_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
}

export type NavLot = { id: number; name: string };

/** The lots listed under Lots in the sidebar (callers pass them most recent first) and how many more there are. */
export function navLots(lots: NavLot[], max: number): { shown: NavLot[]; more: number } {
  return { shown: lots.slice(0, max).map(({ id, name }) => ({ id, name })), more: Math.max(0, lots.length - max) };
}

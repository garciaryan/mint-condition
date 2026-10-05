// What the Discogs API terms of use require of any app showing their data. Client-safe: no imports.

/** Discogs data may not be shown more than 6 hours behind discogs.com, so it is never cached or shown longer. */
export const MAX_CACHE_HOURS = 6;

/** Shown prominently on every page. */
export const NOT_AFFILIATED =
  "This application uses Discogs’ API but is not affiliated with, sponsored or endorsed by Discogs. ‘Discogs’ is a trademark of Zink Media, LLC.";

/** Shown next to Discogs data, linked to the discogs.com page holding it (never rel="nofollow"). */
export const DATA_CREDIT = "Data provided by Discogs";

export const releaseUrl = (id: number): string => `https://www.discogs.com/release/${id}`;

/** The Discogs search page for a catalog number: where the pressings in a pick list come from. */
export const searchUrl = (catno: string): string => `https://www.discogs.com/search/?q=${encodeURIComponent(catno)}&type=release`;

/** The marketplace, credited next to totals worked out from many releases' prices. */
export const MARKETPLACE_URL = "https://www.discogs.com/sell/list";

/** True once Discogs data fetched at `fetchedAt` is past the 6-hour display limit. */
export function dataExpired(fetchedAt: number, now: number): boolean {
  return now - fetchedAt > MAX_CACHE_HOURS * 3_600_000;
}

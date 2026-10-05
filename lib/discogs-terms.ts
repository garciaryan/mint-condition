// What the Discogs API terms of use require of any app showing their data. Client-safe: no imports.

/** Discogs data may not be shown more than 6 hours behind discogs.com, so it is never cached or shown longer. */
export const MAX_CACHE_HOURS = 6;

/** Shown prominently on every page. */
export const NOT_AFFILIATED =
  "This application uses Discogs’ API but is not affiliated with, sponsored or endorsed by Discogs. ‘Discogs’ is a trademark of Zink Media, LLC.";

/** Shown next to Discogs data, linked to the discogs.com page holding it (never rel="nofollow"). */
export const DATA_CREDIT = "Data provided by Discogs";

export const releaseUrl = (id: number): string => `https://www.discogs.com/release/${id}`;

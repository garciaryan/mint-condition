// Human-friendly ages for timestamps. Pure and client-safe.

/** "just now", "5 minutes ago", "yesterday", or a short date for anything older than a week. */
export function relativeTime(t: number, now = Date.now()): string {
  const secs = Math.round((now - t) / 1000);
  if (secs < 60) return "just now";
  const rtf = new Intl.RelativeTimeFormat("en-US", { numeric: "auto" });
  if (secs < 3600) return rtf.format(-Math.floor(secs / 60), "minute");
  if (secs < 86400) return rtf.format(-Math.floor(secs / 3600), "hour");
  if (secs < 7 * 86400) return rtf.format(-Math.floor(secs / 86400), "day");
  return new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

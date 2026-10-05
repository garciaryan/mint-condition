// Small helpers for the browser components. Client-safe: no Node or server imports.

export function defaultLotName(now: Date): string {
  return `Lot ${now.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
}

/** Poll fast while lookups are queued, slowly otherwise. */
export function pollDelayMs(pending: number): number {
  return pending > 0 ? 2000 : 15000;
}

/** Returns false when the same code was accepted within the window (stops double adds). */
export function createScanFilter(windowMs = 3000): (code: string, now: number) => boolean {
  const lastAccepted = new Map<string, number>();
  return (code, now) => {
    const last = lastAccepted.get(code);
    if (last !== undefined && now - last < windowMs) return false;
    lastAccepted.set(code, now);
    return true;
  };
}

/** "62 of 70 priced · 4 to pick · 2 no price · 1 error"; zero parts after "priced" are omitted. */
export function coverageText(t: { priced: number; total: number; toPick: number; noPrice: number; problems: number }): string {
  const parts = [`${t.priced} of ${t.total} priced`];
  if (t.toPick > 0) parts.push(`${t.toPick} to pick`);
  if (t.noPrice > 0) parts.push(`${t.noPrice} no price`);
  if (t.problems > 0) parts.push(`${t.problems} error`);
  return parts.join(" · ");
}

/** "5 sec" under a minute, otherwise whole minutes ("2 min"). */
export function etaText(seconds: number): string {
  return seconds < 60 ? `${Math.max(1, Math.round(seconds))} sec` : `${Math.round(seconds / 60)} min`;
}

/** "23 records" or "23 records, 1 line skipped: line 4" for the paste preview. */
export function pasteSummary(count: number, skippedLines: number[]): string {
  const base = `${count} ${count === 1 ? "record" : "records"}`;
  if (skippedLines.length === 0) return base;
  const shown = skippedLines.slice(0, 5).join(", ");
  const more = skippedLines.length > 5 ? ", …" : "";
  const n = skippedLines.length;
  return `${base}, ${n} ${n === 1 ? "line" : "lines"} skipped: ${n === 1 ? "line" : "lines"} ${shown}${more}`;
}

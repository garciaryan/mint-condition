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

// Small helpers for the browser components. Client-safe: no Node or server imports.
import type { OfferView } from "../offer.ts";

export function defaultLotName(now: Date): string {
  return `Collection ${now.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
}

/** Poll fast while lookups are queued and moving, slowly otherwise (idle or paused). */
export function pollDelayMs(pending: number, paused = false): number {
  return pending > 0 && !paused ? 2000 : 15000;
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

/** A no-price row that now has a market value (grade changed) reads as priced. */
export function displayStatus(item: { status: StatusKey; market: unknown }): StatusKey {
  return item.status === "no-price" && item.market ? "priced" : item.status;
}

/** "62 of 70 priced · 4 to pick · 2 no price · 1 error"; zero parts after "priced" are omitted. */
export function coverageText(t: {
  priced: number;
  total: number;
  toPick: number;
  noPrice: number;
  problems: number;
  refreshing?: number;
  stale?: number;
  slow?: number;
}): string {
  const parts = [`${t.priced} of ${t.total} priced`];
  if (t.toPick > 0) parts.push(`${t.toPick} to pick`);
  if (t.noPrice > 0) parts.push(`${t.noPrice} no price`);
  if (t.problems > 0) parts.push(`${t.problems} error`);
  if (t.refreshing) parts.push(`${t.refreshing} updating`);
  if (t.stale) parts.push(`${t.stale} couldn't refresh`);
  if (t.slow) parts.push(`${t.slow} slow`);
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

/** Runs async jobs strictly one at a time, in the order added. A rejected job does not block the next. */
export function createSerialQueue(): <T>(job: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(job: () => Promise<T>) => {
    const run = tail.then(job, job);
    tail = run.catch(() => {});
    return run;
  };
}

export type StatusKey = "pending" | "looking-up" | "to-pick" | "priced" | "no-match" | "no-price" | "error";
export type StatusIcon = "check" | "list" | "dash" | "warn" | "x" | "clock" | "spinner";

/** Label, CSS class and icon for an item status; shared by the lot rows and the scan list. */
export const STATUS_INFO: Record<StatusKey, { text: string; cls: string; icon: StatusIcon }> = {
  pending: { text: "Queued", cls: "s-wait", icon: "clock" },
  "looking-up": { text: "Looking up", cls: "s-wait", icon: "spinner" },
  "to-pick": { text: "To pick", cls: "s-pick", icon: "list" },
  priced: { text: "Priced", cls: "s-ok", icon: "check" },
  "no-match": { text: "No match", cls: "s-none", icon: "x" },
  "no-price": { text: "No price data", cls: "s-none", icon: "dash" },
  error: { text: "Error", cls: "s-err", icon: "warn" },
};

/** Currency amount; whole dollars unless the amount has cents (or `cents` forces them). */
export function cash(n: number, currency: string, cents = !Number.isInteger(n)): string {
  const opts = { style: "currency", currency, minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 } as const;
  try {
    return new Intl.NumberFormat("en-US", opts).format(n);
  } catch {
    return new Intl.NumberFormat("en-US", { ...opts, currency: "USD" }).format(n);
  }
}

/** "Offer · open $13 · max $18": the whole-lot opening rung and walk-away. */
export function offerSummary(offer: OfferView, currency: string): string {
  const open = offer.wholeLot.rungs.find((r) => r.percent === offer.openingPercent)!;
  return `Offer · open ${cash(open.amount, currency)} · max ${cash(offer.wholeLot.walkAway, currency)}`;
}

/** Caveats under the offer tables, in display order; only the ones that apply. */
export function offerNotes(offer: OfferView, currency: string): string[] {
  const notes: string[] = [];
  const n = offer.unpricedCount;
  if (n > 0) {
    notes.push(`${n} ${n === 1 ? "record" : "records"} unpriced, counted as bulk at ${cash(offer.inputs.bulkEach, currency, true)} each`);
  }
  if (offer.inputs.unverified) {
    const s = offer.inputs.unverifiedSteps;
    notes.push(`Grades lowered ${s} ${s === 1 ? "step" : "steps"} for this offer (condition unverified)`);
  }
  if (offer.inputs.skipSlow) notes.push("Slow sellers left out of cherry-picks");
  if (offer.picks === 0) {
    const tail = offer.inputs.skipSlow ? " once slow sellers are left out" : "";
    notes.push(`Picks: none at or above ${cash(offer.inputs.pickThreshold, currency)}${tail}`);
  }
  return notes;
}

/** "3,357 want · 878 have" for a lot row, or null when Discogs sent no counts (rows priced before Phase 10). */
export function wantHaveText(c: { want?: number; have?: number }): string | null {
  if (c.want === undefined || c.have === undefined) return null;
  return `${c.want.toLocaleString("en-US")} want · ${c.have.toLocaleString("en-US")} have`;
}

/** The offer panel's Options button: "Options", or "Options · 1 on" when any option is ticked. */
export function offerOptionsLabel(unverified: boolean, skipSlow: boolean): string {
  const on = Number(unverified) + Number(skipSlow);
  return on === 0 ? "Options" : `Options · ${on} on`;
}

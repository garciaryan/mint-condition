// Matching a runout fragment against a release's Discogs identifiers (matrix/runout, plant, mastering SID...).
// Pure and client-safe. Case and everything but letters and digits are ignored, so "1577a" finds "BN 1577-A".
import type { Identifier } from "./types.ts";

/** The most pressings "Check runouts" fetches at once (about 28 seconds at the shared throttle). */
export const RUNOUT_CHECK_CAP = 25;

export function normalizeRunout(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** An identifier that matched, with the [start, end) ranges of `identifier.value` to highlight. */
export type RunoutHit = { identifier: Identifier; ranges: [number, number][] };

/** Identifiers whose value contains the query (normalized). An empty query matches all, unhighlighted. */
export function matchIdentifiers(identifiers: Identifier[], query: string): RunoutHit[] {
  const q = normalizeRunout(query);
  if (!q) return identifiers.map((identifier) => ({ identifier, ranges: [] }));
  const hits: RunoutHit[] = [];
  for (const identifier of identifiers) {
    // Original index of each letter or digit, so a match in the normalized text maps back onto the value.
    const kept: number[] = [];
    let norm = "";
    for (let i = 0; i < identifier.value.length; i++) {
      const c = identifier.value[i].toUpperCase();
      if (/[A-Z0-9]/.test(c)) {
        kept.push(i);
        norm += c;
      }
    }
    const ranges: [number, number][] = [];
    for (let at = norm.indexOf(q); at !== -1; at = norm.indexOf(q, at + 1)) {
      ranges.push([kept[at], kept[at + q.length - 1] + 1]);
    }
    if (ranges.length > 0) hits.push({ identifier, ranges });
  }
  return hits;
}

/** Which showing pressings "Check runouts" would fetch (in order), and whether there are too many showing. */
export function checkPlan(visibleIds: number[], loaded: ReadonlySet<number>): { toCheck: number[]; overCap: boolean } {
  return { toCheck: visibleIds.filter((id) => !loaded.has(id)), overCap: visibleIds.length > RUNOUT_CHECK_CAP };
}

export function uncheckedCount(visibleIds: number[], loaded: ReadonlySet<number>): number {
  return visibleIds.filter((id) => !loaded.has(id)).length;
}

/** One pressing's runouts in the picker. */
export type RunoutState = { status: "loading" } | { status: "loaded"; identifiers: Identifier[] } | { status: "error"; message: string };

/** While a runout query is typed: show matching loaded pressings, and failed ones too so their error and Retry stay
 * in sight. Loading and untried pressings are counted instead ("N not checked yet"). */
export function searchVisible(state: RunoutState | undefined, query: string): boolean {
  if (state?.status === "error") return true;
  return state?.status === "loaded" && matchIdentifiers(state.identifiers, query).length > 0;
}

/** Showing pressings never tried, tried and failed, and loaded. A failure isn't "not checked yet". */
export function runoutCounts(visibleIds: number[], states: ReadonlyMap<number, RunoutState>): { notTried: number; failed: number; loaded: number } {
  const c = { notTried: 0, failed: 0, loaded: 0 };
  for (const id of visibleIds) {
    const s = states.get(id);
    if (!s) c.notTried++;
    else if (s.status === "error") c.failed++;
    else if (s.status === "loaded") c.loaded++;
  }
  return c;
}

/** Whether a row's runouts panel is open. A search opens loaded and failed rows by itself; the owner's own click
 * (opened / collapsed) always wins. */
export function isExpanded(
  id: number,
  opened: ReadonlySet<number>,
  collapsed: ReadonlySet<number>,
  state: RunoutState | undefined,
  searching: boolean,
): boolean {
  if (collapsed.has(id)) return false;
  if (opened.has(id)) return true;
  return searching && (state?.status === "loaded" || state?.status === "error");
}

/** The open/closed sets after the owner clicks a row's Runouts toggle, from what it shows now. */
export function toggleExpanded(
  id: number,
  opened: ReadonlySet<number>,
  collapsed: ReadonlySet<number>,
  expandedNow: boolean,
): { opened: Set<number>; collapsed: Set<number> } {
  const o = new Set(opened);
  const c = new Set(collapsed);
  if (expandedNow) {
    o.delete(id);
    c.add(id);
  } else {
    c.delete(id);
    o.add(id);
  }
  return { opened: o, collapsed: c };
}

// A master's vinyl versions on the result card: sorting, the earliest listed year, and whether this copy is a reissue.
// Pure and client-safe. "Earliest" means earliest listed on Discogs, never "original".
import type { Candidate } from "./types.ts";

/** GET /api/masters/:id/versions. `total` counts every vinyl version, even past the pages fetched. */
export type VersionsResponse = { versions: Candidate[]; total: number; fetchedAt: number };

export type VersionFlag = "earliest" | "reissue";

/** Years ascending, unknown years last; order within a year is kept. */
export function sortVersions(vs: Candidate[]): Candidate[] {
  const key = (c: Candidate) => c.year ?? Infinity;
  return vs.map((c, i) => ({ c, i })).sort((a, b) => key(a.c) - key(b.c) || a.i - b.i).map((x) => x.c);
}

export function earliestYear(vs: Candidate[]): number | null {
  let min: number | null = null;
  for (const c of vs) if (c.year !== null && (min === null || c.year < min)) min = c.year;
  return min;
}

export function versionFlag(thisYear: number | null, earliest: number | null): VersionFlag | null {
  if (thisYear === null || earliest === null) return null;
  return thisYear > earliest ? "reissue" : "earliest";
}

/** This copy's year from the versions list, or `fallback` (the card's year) when it isn't there or has none. */
export function thisCopyYear(vs: Candidate[], releaseId: number, fallback: number | null): number | null {
  return vs.find((c) => c.id === releaseId)?.year ?? fallback;
}

export function filterVersions(vs: Candidate[], text: string): Candidate[] {
  const q = text.trim().toLowerCase();
  if (!q) return vs;
  return vs.filter((c) =>
    [c.label, c.catno, c.country, c.format, c.year === null ? null : String(c.year)].some((f) => f?.toLowerCase().includes(q)),
  );
}

/** Search titles read "Artist - Title" but versions carry only the title; a picked version keeps the card's artist. */
export function withArtist(cardTitle: string | null | undefined, versionTitle: string): string {
  if (!versionTitle) return cardTitle ?? "";
  const at = cardTitle?.indexOf(" - ") ?? -1;
  if (!cardTitle || at < 0) return versionTitle;
  const artist = cardTitle.slice(0, at + 3);
  return versionTitle.startsWith(artist) ? versionTitle : artist + versionTitle;
}

/** Versions shown per page in the panel (the whole list is already fetched; paging is display only). */
export const VERSIONS_PAGE_SIZE = 20;

/** One page of `items` (1-based, clamped to the pages there are). An empty list is a single empty page. */
export function paginate<T>(items: T[], page: number, size: number): { items: T[]; page: number; pages: number } {
  const pages = Math.max(1, Math.ceil(items.length / size));
  const p = Math.min(Math.max(1, page), pages);
  return { items: items.slice((p - 1) * size, p * size), page: p, pages };
}

/** The 1-based page holding `index`; -1 (not found) is page 1. */
export function pageOf(index: number, size: number): number {
  return index < 0 ? 1 : Math.floor(index / size) + 1;
}

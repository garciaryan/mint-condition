// Client-side form checks and picker grouping for the lookup page. Pure; safe to import from the browser.
import type { Candidate } from "./types.ts";

export type FieldErrors = { catno?: string; year?: string };

/** Mirrors the server's rules in parseLookupRequest so errors show next to the field before a round trip. */
export function fieldErrors(catno: string, year: string): FieldErrors {
  const out: FieldErrors = {};
  if (!catno.trim()) out.catno = "Enter a catalog number or barcode.";
  const y = year.trim();
  if (y) {
    const n = Number(y);
    if (!/^\d{4}$/.test(y) || n < 1890 || n > 2100) out.year = "Use a 4-digit year, e.g. 1971, or leave it blank.";
  }
  return out;
}

export type CandidateGroup = { title: string; items: Candidate[] };

/** Filters candidates by free text, then groups them by how close their year is to the searched year. */
export function groupCandidates(candidates: Candidate[], filter: string, year?: number): CandidateGroup[] {
  const q = filter.trim().toLowerCase();
  const shown = q
    ? candidates.filter((c) =>
        [c.title, c.label, c.catno, c.country, c.format, c.year].some((v) => String(v ?? "").toLowerCase().includes(q)),
      )
    : candidates;
  const groups: CandidateGroup[] = year
    ? [
        { title: String(year), items: shown.filter((c) => c.year === year) },
        { title: "Within a year", items: shown.filter((c) => c.year !== null && c.year !== year) },
        { title: "Year unknown", items: shown.filter((c) => c.year === null) },
      ]
    : [{ title: "All pressings", items: shown }];
  return groups.filter((g) => g.items.length > 0);
}

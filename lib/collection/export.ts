// Lot exports: the Discogs inventory-upload CSV and the printable buy sheet's rows. Pure.
import { priceRecord } from "../pricing.ts";
import type { Grade, Settings } from "../types.ts";
import type { ItemRow } from "./types.ts";

/** Condition names exactly as Discogs' inventory upload expects them. */
export const DISCOGS_GRADE: Record<Grade, string> = {
  M: "Mint (M)",
  NM: "Near Mint (NM or M-)",
  "VG+": "Very Good Plus (VG+)",
  VG: "Very Good (VG)",
  "G+": "Good Plus (G+)",
  G: "Good (G)",
  F: "Fair (F)",
  P: "Poor (P)",
};

const COLUMNS = ["release_id", "price", "media_condition", "sleeve_condition", "status", "external_id", "private_notes"];
const LISTING_STATUS = "Draft";

/** A row's listing (release and sell price at its own grades), or null when it can't be listed. */
function exportable(item: ItemRow, settings: Settings): { releaseId: number; price: number } | null {
  if (item.status !== "priced" || item.releaseId === null || !item.suggestions) return null;
  const p = priceRecord({
    suggestions: item.suggestions,
    lowestListing: item.stats?.lowestPrice ?? null,
    record: item.record,
    sleeve: item.sleeve,
    settings,
  });
  return p && p.sell.price > 0 ? { releaseId: item.releaseId, price: p.sell.price } : null;
}

/** RFC 4180 field. Values a spreadsheet would run as a formula get a leading space. */
function field(value: string): string {
  const v = /^[=+\-@]/.test(value) ? ` ${value}` : value;
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function toDiscogsCsv(lotName: string, items: ItemRow[], settings: Settings): string {
  const lines = [COLUMNS.join(",")];
  for (const item of items) {
    const listing = exportable(item, settings);
    if (!listing) continue;
    lines.push(
      [
        String(listing.releaseId),
        listing.price.toFixed(2),
        DISCOGS_GRADE[item.record],
        DISCOGS_GRADE[item.sleeve],
        LISTING_STATUS,
        `mc-${item.id}`,
        lotName,
      ]
        .map(field)
        .join(","),
    );
  }
  return `${lines.join("\r\n")}\r\n`;
}

export function exportCounts(items: ItemRow[], settings: Settings): { exportable: number; lookingUp: number; skipped: number } {
  const counts = { exportable: 0, lookingUp: 0, skipped: 0 };
  for (const item of items) {
    if (exportable(item, settings)) counts.exportable++;
    else if (item.status === "pending" || item.status === "working") counts.lookingUp++;
    else counts.skipped++;
  }
  return counts;
}

export function csvFilename(lotName: string, lotId: number): string {
  const slug = lotName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
  return `${slug || `lot-${lotId}`}-discogs.csv`;
}

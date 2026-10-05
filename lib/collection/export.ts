// Lot exports: the Discogs inventory-upload CSV and the printable buy sheet's rows. Pure.
import { isPickRow } from "../offer.ts";
import type { OfferInputs } from "../offer.ts";
import { priceRecord } from "../pricing.ts";
import type { Grade, Settings } from "../types.ts";
import type { ItemRow, ItemStatus } from "./types.ts";
import { marketFor } from "./view.ts";

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

export type BuySheetRow = {
  id: number;
  query: string;
  /** Release title; null when no pressing is chosen. */
  title: string | null;
  /** "label · year" from the parts that exist; "" when none. */
  detail: string;
  record: Grade;
  sleeve: Grade;
  /** Market suggested value at the row's grades. */
  suggested: number | null;
  sell: number | null;
  isPick: boolean;
  /** Null when priced; otherwise why there is no value. */
  statusLabel: string | null;
};

const STATUS_LABEL: Record<ItemStatus, string | null> = {
  priced: null,
  "no-match": "No match",
  "to-pick": "To pick",
  "no-price": "No price",
  error: "Error",
  pending: "Looking up",
  working: "Looking up",
};

/** Rows for the printed buy sheet: picks first, then by suggested value (high to low); rows without a value last, in
 * lot order. */
export function buySheetRows(items: ItemRow[], settings: Settings, inputs: OfferInputs): BuySheetRow[] {
  const rows = items.map((item): BuySheetRow => {
    const market = marketFor(item, settings);
    const priced = item.suggestions
      ? priceRecord({ suggestions: item.suggestions, lowestListing: item.stats?.lowestPrice ?? null, record: item.record, sleeve: item.sleeve, settings })
      : null;
    return {
      id: item.id,
      query: item.query,
      title: item.release?.title ?? null,
      detail: [item.release?.label, item.release?.year].filter(Boolean).join(" · "),
      record: item.record,
      sleeve: item.sleeve,
      suggested: market?.suggested ?? null,
      sell: priced?.sell.price ?? null,
      isPick: isPickRow(item, inputs, settings),
      statusLabel: market ? STATUS_LABEL[item.status] : (STATUS_LABEL[item.status] ?? "No price"),
    };
  });
  const valued = rows.filter((r) => r.suggested !== null);
  const rest = rows.filter((r) => r.suggested === null);
  valued.sort((a, b) => Number(b.isPick) - Number(a.isPick) || (b.suggested ?? 0) - (a.suggested ?? 0));
  return [...valued, ...rest];
}

/** The line under the export link, e.g. "18 to export · 2 still looking up · 3 without a price". */
export function exportHint(c: { exportable: number; lookingUp: number; skipped: number }): string {
  return [
    c.exportable > 0 ? `${c.exportable} to export` : "Nothing to export yet",
    c.lookingUp > 0 ? `${c.lookingUp} still looking up` : null,
    c.skipped > 0 && c.exportable > 0 ? `${c.skipped} without a price` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

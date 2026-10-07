import type { Demand } from "@/lib/demand.ts";

const n = (v: number) => v.toLocaleString("en-US");

/** "Sells fast" / "Slow seller" from Discogs want/have and copies for sale (lib/demand.ts). Nothing for normal or
 * unknown demand. The counts are read out by screen readers; sighted users see them beside the badge (lot rows) or in
 * the stats list (result card), so there is no title tooltip to repeat them. Discogs data: render it only next to
 * the Discogs credit (tests/discogs-terms.test.ts). */
export default function DemandBadge({ demand, have, want, forSale }: { demand: Demand | null; have?: number; want?: number; forSale: number }) {
  if (demand !== "fast" && demand !== "slow") return null;
  const counts = have !== undefined && want !== undefined ? `${n(want)} want · ${n(have)} have · ${n(forSale)} for sale` : `${n(forSale)} for sale`;
  return (
    <span className={`demand ${demand}`}>
      {demand === "fast" ? "Sells fast" : "Slow seller"}
      <span className="sr-only"> ({counts})</span>
    </span>
  );
}

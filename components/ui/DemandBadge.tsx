import type { Demand } from "@/lib/demand.ts";

const n = (v: number) => v.toLocaleString("en-US");

/** "Sells fast" / "Slow seller" from Discogs want/have and copies for sale (lib/demand.ts). Nothing for normal or
 * unknown demand. The counts are in the title and, for screen readers, in the text. Discogs data: render it only
 * next to the Discogs credit (tests/discogs-terms.test.ts). */
export default function DemandBadge({ demand, have, want, forSale }: { demand: Demand | null; have?: number; want?: number; forSale: number }) {
  if (demand !== "fast" && demand !== "slow") return null;
  const counts = have !== undefined && want !== undefined ? `${n(want)} want · ${n(have)} have · ${n(forSale)} for sale` : `${n(forSale)} for sale`;
  return (
    <span className={`demand ${demand}`} title={counts}>
      {demand === "fast" ? "Sells fast" : "Slow seller"}
      <span className="sr-only"> ({counts})</span>
    </span>
  );
}

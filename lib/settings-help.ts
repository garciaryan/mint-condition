// What each setting changes, shown behind the ⓘ button on /settings. Client-safe, pure.
import type { FieldKey } from "./settings-form.ts";

const HELP: Partial<Record<FieldKey, string>> = {
  "sell.undercutPercent":
    "How far below the Discogs suggestion to list, so yours is the cheaper copy. Sell price = market value minus this %.",
  "sell.floor": "The sell price never goes below this, however low the market value is.",
  "sell.discogsFeePercent":
    "Discogs' seller fee. Used for what you'd net at the sell price, and for what picks would net in an offer's walk-away.",
  "offer.ladderPercents":
    "The offer steps, as % of the cherry-picks' suggested value, lowest first, separated by commas.",
  "offer.openingPercent": "Which ladder step to open with.",
  "offer.marginPercent":
    "How much of what the picks would net on Discogs you want to keep. The walk-away is set so you keep at least this.",
  "offer.overheadPerRecord":
    "Your cost per cherry-pick (cleaning, sleeves, listing time), taken off the walk-away for each pick.",
  "offer.pickThreshold":
    "Records with a suggested value at or above this count as cherry-picks. Used by any collection that doesn't set its own.",
  "offer.bulkEach": "What you'd pay per non-pick record in a whole-collection offer. Used by any collection that doesn't set its own.",
  "offer.unverifiedSteps":
    "When a collection is marked \"Condition unverified\", offers price every record this many grades lower, record and sleeve.",
  "discogs.cacheHours":
    "How long Discogs answers are reused before asking again. At most 6 (Discogs terms); 0 turns the cache off.",
};

/** One note for the whole sleeve grid, on its section heading. */
export const SLEEVE_HELP =
  "Market value = the Discogs suggestion for the record grade × the sleeve's percentage. A VG sleeve at 85% keeps 85% of the record's value.";

/** Help for one field, or null for the sleeve grades (they share SLEEVE_HELP). */
export function settingHelp(key: FieldKey): string | null {
  return HELP[key] ?? null;
}

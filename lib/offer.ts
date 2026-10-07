// Pure offer calculator: no network, no filesystem, no DB. Everything tunable comes from Settings.
import { downgrade, marketValue, roundCents, sellPrice } from "./pricing.ts";
import type { MarketValue } from "./pricing.ts";
import { demand } from "./demand.ts";
import type { Settings } from "./types.ts";
import type { ItemRow } from "./collection/types.ts";

/** A lot's offer inputs with settings defaults applied. */
export type OfferInputs = { unverified: boolean; pickThreshold: number; bulkEach: number; lotOverhead: number; skipSlow: boolean };
export type Rung = { percent: number; amount: number; keep: number; overMax: boolean };
export type OfferSide = { rungs: Rung[]; walkAway: number };
export type OfferView = {
  inputs: OfferInputs & { unverifiedSteps: number; overheadPerRecord: number; marginPercent: number };
  openingPercent: number;
  picks: number;
  bulkCount: number;
  unpricedCount: number;
  pickValue: number;
  pickNet: number;
  pickOnly: OfferSide;
  wholeLot: OfferSide;
};

/** Whole dollars, rounded down. Rounding to cents first keeps float error (28.999…) from losing a dollar. */
const dollars = (n: number): number => Math.floor(roundCents(n));

export function offerInputs(
  lot: { unverified: boolean; pickThreshold: number | null; bulkEach: number | null; lotOverhead: number; skipSlow?: boolean },
  settings: Settings,
): OfferInputs {
  return {
    unverified: lot.unverified,
    pickThreshold: lot.pickThreshold ?? settings.offer.pickThreshold,
    bulkEach: lot.bulkEach ?? settings.offer.bulkEach,
    lotOverhead: lot.lotOverhead,
    skipSlow: lot.skipSlow ?? false,
  };
}

/** Market value at the offer grades: the row's grades, lowered when the lot's condition is unverified. */
export function offerMarket(item: ItemRow, inputs: OfferInputs, settings: Settings): MarketValue | null {
  if (!item.suggestions) return null;
  const steps = inputs.unverified ? settings.offer.unverifiedSteps : 0;
  return marketValue(item.suggestions, downgrade(item.record, steps), downgrade(item.sleeve, steps), settings);
}

/** A pin (the owner's star) always wins; otherwise the threshold decides, and with skipSlow on a slow seller is left
 * out. Unknown demand (no want/have yet) is never skipped. */
function pickFor(market: MarketValue | null, item: ItemRow, inputs: OfferInputs, settings: Settings): boolean {
  if (!market) return false;
  if (item.pick !== null) return item.pick;
  if (inputs.skipSlow && demand(item.stats, settings.demand) === "slow") return false;
  return market.suggested >= inputs.pickThreshold;
}

export function isPickRow(item: ItemRow, inputs: OfferInputs, settings: Settings): boolean {
  return pickFor(offerMarket(item, inputs, settings), item, inputs, settings);
}

function side(percents: number[], amountAt: (percent: number) => number, walkAway: number): OfferSide {
  return {
    rungs: percents.map((percent) => {
      const amount = amountAt(percent);
      return { percent, amount, keep: walkAway - amount, overMax: amount > walkAway };
    }),
    walkAway,
  };
}

type PickTally = { picks: number; pickValue: number; pickNet: number };

function tallyPicks(items: ItemRow[], inputs: OfferInputs, settings: Settings): PickTally {
  const feeKeep = 1 - settings.sell.discogsFeePercent / 100;
  const t: PickTally = { picks: 0, pickValue: 0, pickNet: 0 };
  for (const item of items) {
    const market = offerMarket(item, inputs, settings);
    if (!pickFor(market, item, inputs, settings)) continue;
    t.picks++;
    t.pickValue += market!.suggested;
    t.pickNet += sellPrice(market!, item.stats?.lowestPrice ?? null, settings).price * feeKeep;
  }
  return t;
}

export function computeOffer(items: ItemRow[], inputs: OfferInputs, settings: Settings): OfferView {
  const o = settings.offer;
  const unpricedCount = items.filter((item) => !offerMarket(item, inputs, settings)).length;
  // skipSlow narrows the cherry-picks only: you buy the slow records either way in a whole-collection offer, so that
  // side still values them as picks.
  const cherry = tallyPicks(items, inputs, settings);
  const whole = inputs.skipSlow ? tallyPicks(items, { ...inputs, skipSlow: false }, settings) : cherry;
  // What the picks leave after margin and overhead. It can be negative when the lot overhead is more than the picks
  // cover; the whole-lot walk-away still has to pay for that, so only the final amounts are floored at 0.
  const room = (t: PickTally) => t.pickNet * (1 - o.marginPercent / 100) - o.overheadPerRecord * t.picks - inputs.lotOverhead;
  const wholeBulk = inputs.bulkEach * (items.length - whole.picks);
  const pickWalkAway = Math.max(0, dollars(room(cherry)));
  const wholeWalkAway = Math.max(0, dollars(room(whole) + wholeBulk));
  return {
    inputs: { ...inputs, unverifiedSteps: o.unverifiedSteps, overheadPerRecord: o.overheadPerRecord, marginPercent: o.marginPercent },
    openingPercent: o.openingPercent,
    picks: cherry.picks,
    bulkCount: items.length - cherry.picks,
    unpricedCount,
    pickValue: roundCents(cherry.pickValue),
    pickNet: roundCents(cherry.pickNet),
    pickOnly: side(o.ladderPercents, (p) => dollars((p / 100) * cherry.pickValue), pickWalkAway),
    wholeLot: side(o.ladderPercents, (p) => dollars((p / 100) * whole.pickValue + wholeBulk), wholeWalkAway),
  };
}

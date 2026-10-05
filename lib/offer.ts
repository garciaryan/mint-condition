// Pure offer calculator: no network, no filesystem, no DB. Everything tunable comes from Settings.
import { downgrade, marketValue, roundCents, sellPrice } from "./pricing.ts";
import type { MarketValue } from "./pricing.ts";
import type { Settings } from "./types.ts";
import type { ItemRow } from "./collection/types.ts";

/** A lot's offer inputs with settings defaults applied. */
export type OfferInputs = { unverified: boolean; pickThreshold: number; bulkEach: number; lotOverhead: number };
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
  lot: { unverified: boolean; pickThreshold: number | null; bulkEach: number | null; lotOverhead: number },
  settings: Settings,
): OfferInputs {
  return {
    unverified: lot.unverified,
    pickThreshold: lot.pickThreshold ?? settings.offer.pickThreshold,
    bulkEach: lot.bulkEach ?? settings.offer.bulkEach,
    lotOverhead: lot.lotOverhead,
  };
}

/** Market value at the offer grades: the row's grades, lowered when the lot's condition is unverified. */
export function offerMarket(item: ItemRow, inputs: OfferInputs, settings: Settings): MarketValue | null {
  if (!item.suggestions) return null;
  const steps = inputs.unverified ? settings.offer.unverifiedSteps : 0;
  return marketValue(item.suggestions, downgrade(item.record, steps), downgrade(item.sleeve, steps), settings);
}

function pickFor(market: MarketValue | null, item: ItemRow, inputs: OfferInputs): boolean {
  if (!market) return false;
  return item.pick ?? market.suggested >= inputs.pickThreshold;
}

export function isPickRow(item: ItemRow, inputs: OfferInputs, settings: Settings): boolean {
  return pickFor(offerMarket(item, inputs, settings), item, inputs);
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

export function computeOffer(items: ItemRow[], inputs: OfferInputs, settings: Settings): OfferView {
  const o = settings.offer;
  const feeKeep = 1 - settings.local.discogsFeePercent / 100;
  let picks = 0, unpricedCount = 0, pickValue = 0, pickNet = 0;
  for (const item of items) {
    const market = offerMarket(item, inputs, settings);
    if (!market) unpricedCount++;
    if (!pickFor(market, item, inputs)) continue;
    picks++;
    pickValue += market!.suggested;
    pickNet += sellPrice(market!, item.stats?.lowestPrice ?? null, settings).price * feeKeep;
  }
  const bulkCount = items.length - picks;
  const bulk = inputs.bulkEach * bulkCount;
  const pickWalkAway = Math.max(
    0,
    dollars(pickNet * (1 - o.marginPercent / 100) - o.overheadPerRecord * picks - inputs.lotOverhead),
  );
  const wholeWalkAway = dollars(pickWalkAway + bulk);
  return {
    inputs: { ...inputs, unverifiedSteps: o.unverifiedSteps, overheadPerRecord: o.overheadPerRecord, marginPercent: o.marginPercent },
    openingPercent: o.openingPercent,
    picks,
    bulkCount,
    unpricedCount,
    pickValue: roundCents(pickValue),
    pickNet: roundCents(pickNet),
    pickOnly: side(o.ladderPercents, (p) => dollars((p / 100) * pickValue), pickWalkAway),
    wholeLot: side(o.ladderPercents, (p) => dollars((p / 100) * pickValue + bulk), wholeWalkAway),
  };
}

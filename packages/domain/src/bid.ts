/**
 * The inspection bid. The BUYER sets the amount they will pay a dealer to do the job, and the
 * platform takes no cut of it (`docs/DECISIONS.md` section 5).
 *
 * The suggested band is a pure km rate - Rs 30 per km of seller-to-dealer distance, capped at
 * the 50 km range (Rs 1,500) - and exists only to stop the two failure modes:
 *   - a buyer lowballs so hard no dealer accepts, and
 *   - a buyer overpays because they have no reference point.
 * A bid below the floor is ALLOWED and flagged to dealers. It is never blocked.
 */

import { type Money, assertMoney, pkr } from './money.ts';

/**
 * The inspection bid is priced off DISTANCE ONLY - the kilometres between the seller and the
 * dealer. One rate, no category maths: Rs 30/km, so the full 50 km range is a Rs 1,500 normal
 * bid, and a 10 km job is a Rs 300 normal bid.
 */
export const BID_PER_KM_PKR = 30;
/** Nothing is ever priced beyond the product's maximum search range. */
export const MAX_DISTANCE_KM = 50;

export type BandInput = {
  /** Distance between seller and dealer (the job's search range), in km. */
  distanceKm: number;
  /** Difficulty multipliers from enabled flags, e.g. ['after_hours', 'remote']. */
  difficultyMultipliers?: number[];
  /** A serial/IMEI read adds handling. */
  hasSerial?: boolean;
};

export type Band = { min: Money; mid: Money; max: Money };

/** Suggested bid range. Mirrors docs/06 section 3.1 `taskFeeBand`. */
export function suggestedBand(input: BandInput): Band {
  const { distanceKm, difficultyMultipliers = [], hasSerial = false } = input;

  if (!Number.isFinite(distanceKm) || distanceKm < 0) {
    throw new Error(`distanceKm must be a non-negative number, got ${distanceKm}`);
  }

  // Whole kilometres, capped at the max range, and never below a 1 km job.
  const km = Math.min(MAX_DISTANCE_KM, Math.max(1, Math.ceil(distanceKm)));
  let mid = pkr(BID_PER_KM_PKR * km);
  for (const m of difficultyMultipliers) {
    if (!Number.isFinite(m) || m <= 0) throw new Error(`difficulty multiplier must be > 0`);
    mid = Math.round(mid * m);
  }
  if (hasSerial) mid = Math.round(mid * 1.1);

  mid = assertMoney(mid, 'band.mid');
  return {
    min: Math.round(mid * 0.85),
    mid,
    max: Math.round(mid * 1.2),
  };
}

export type BidCheck = {
  amount: Money;
  band: Band;
  /** True when the bid is below band.min. Surfaced to dealers as "below typical". */
  belowBand: boolean;
  /** True when the bid is above band.max. Legitimate but worth a producer warning. */
  aboveBand: boolean;
};

export function checkBid(amount: Money, band: Band): BidCheck {
  assertMoney(amount, 'bid');
  if (amount <= 0) throw new Error('bid must be greater than zero');
  assertMoney(band.min, 'band.min');
  assertMoney(band.mid, 'band.mid');
  assertMoney(band.max, 'band.max');
  return {
    amount,
    band,
    belowBand: amount < band.min,
    aboveBand: amount > band.max,
  };
}

/** Default suggested category bases, in whole rupees, from docs/00 section 4.2. */
export const CATEGORY_BASE_PKR = {
  phone: 1_200,
  laptop: 1_500,
  camera: 1_800,
  tv_or_appliance: 2_500,
  furniture: 2_000,
} as const;

export type Category = keyof typeof CATEGORY_BASE_PKR;

export function categoryBase(category: Category): Money {
  return pkr(CATEGORY_BASE_PKR[category]);
}

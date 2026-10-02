/**
 * Confirmed pricing model. Source of truth: ../DECISIONS.md section 2.
 *
 *   BUYER   5% success fee  (floor Rs 1,500 / cap Rs 15,000)  +  the inspection bid
 *   SELLER  3% success fee  (floor Rs 1,000 / cap Rs  8,000)  only if the sale happens
 *   DEALER  the bid in full  +  2% bonus (floor Rs 1,000 / cap Rs 5,000)
 *   COMPANY the remainder  ->  ~6% of the sale price
 *
 * The inspection bid is buyer-set and is NOT part of this module: the platform takes no cut of
 * it, so it never enters the fee engine (see `docs/DECISIONS.md` section 5).
 *
 * These rates are configuration, not constants, in the running system (`pricing_config`), so a
 * rate change does not require a code change. This module holds the confirmed defaults.
 */

import { type Money, bpsOf, clamp, assertMoney, pkr, add, sub } from './money.ts';

export const BPS = {
  /** 5% */
  buyerFee: 500,
  /** 3% */
  sellerFee: 300,
  /** 2% */
  dealerBonus: 200,
} as const;

export type PricingConfig = {
  buyerFeeBps: number;
  sellerFeeBps: number;
  dealerBonusBps: number;
  floors: { buyer: Money; seller: Money; dealer: Money };
  caps: { buyer: Money; seller: Money; dealer: Money };
};

export const CONFIRMED_PRICING: PricingConfig = {
  buyerFeeBps: BPS.buyerFee,
  sellerFeeBps: BPS.sellerFee,
  dealerBonusBps: BPS.dealerBonus,
  floors: { buyer: pkr(1_500), seller: pkr(1_000), dealer: pkr(1_000) },
  caps: { buyer: pkr(15_000), seller: pkr(8_000), dealer: pkr(5_000) },
};

/**
 * A one-sided percentage of the sale price, clamped to a floor and a cap.
 *
 * A Rs 0 sale yields Rs 0 and is NOT floored — a zero-price sale is a fraud signal handled
 * upstream, not a transaction to be charged. See docs/06 section 3.1.
 */
export function sideFee(
  salePriceMinor: Money,
  bps: number,
  floor: Money,
  cap: Money,
): Money {
  assertMoney(salePriceMinor, 'salePrice');
  if (salePriceMinor === 0) return 0;
  return clamp(bpsOf(salePriceMinor, bps), floor, cap);
}

export function buyerSuccessFee(salePrice: Money, cfg: PricingConfig = CONFIRMED_PRICING): Money {
  return sideFee(salePrice, cfg.buyerFeeBps, cfg.floors.buyer, cfg.caps.buyer);
}

export function sellerSuccessFee(salePrice: Money, cfg: PricingConfig = CONFIRMED_PRICING): Money {
  return sideFee(salePrice, cfg.sellerFeeBps, cfg.floors.seller, cfg.caps.seller);
}

/**
 * The dealer's success bonus. Deliberately NOT a share of the collected fees and NOT a flat 3%
 * of price: the inspection is the same ~2.5 hours whether the item is Rs 15,000 or Rs 500,000.
 * A flat 3% pays Rs 450 or Rs 15,000 for identical work. 2% clamped to Rs 1,000-5,000 is
 * effort-aligned and lands the dealer at the same Rs 4,500 on a typical Rs 150,000 phone that a
 * flat 3% would. See docs/DECISIONS.md section 2.1.
 */
export function dealerSuccessBonus(salePrice: Money, cfg: PricingConfig = CONFIRMED_PRICING): Money {
  return sideFee(salePrice, cfg.dealerBonusBps, cfg.floors.dealer, cfg.caps.dealer);
}

export function companyTake(salePrice: Money, cfg: PricingConfig = CONFIRMED_PRICING): Money {
  return sub(
    add(buyerSuccessFee(salePrice, cfg), sellerSuccessFee(salePrice, cfg)),
    dealerSuccessBonus(salePrice, cfg),
  );
}

export type PricingBreakdown = {
  salePrice: Money;
  buyerFee: Money;
  sellerFee: Money;
  /** buyerFee + sellerFee — the only money that moves through the payment provider. */
  totalFees: Money;
  dealerBonus: Money;
  companyTake: Money;
};

export function pricingBreakdown(
  salePrice: Money,
  cfg: PricingConfig = CONFIRMED_PRICING,
): PricingBreakdown {
  const buyerFee = buyerSuccessFee(salePrice, cfg);
  const sellerFee = sellerSuccessFee(salePrice, cfg);
  const dealerBonus = dealerSuccessBonus(salePrice, cfg);
  const totalFees = add(buyerFee, sellerFee);
  return {
    salePrice,
    buyerFee,
    sellerFee,
    totalFees,
    dealerBonus,
    companyTake: sub(totalFees, dealerBonus),
  };
}

/**
 * What the buyer pays in total, over and above the sale price: the buyer's success fee plus the
 * inspection bid. The seller fee is not the buyer's cost. Used to build the fee explainer.
 */
export function buyerTotalOverSticker(salePrice: Money, inspectionBid: Money): Money {
  return add(buyerSuccessFee(salePrice), inspectionBid);
}

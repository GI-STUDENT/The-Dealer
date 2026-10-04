/**
 * Confirmed pricing model. Source of truth: ../DECISIONS.md section 2.
 *
 *   BUYER   pays price + 0.5% success fee  +  the inspection bid
 *   SELLER  pays 0.5% success fee  only if the sale happens  (collected on the spot)
 *   DEALER  the bid in full  +  0.4% of price  (40% of the 1% fee pool)
 *   COMPANY 0.6% of price  (60% of the 1% fee pool)
 *
 * Pure rates: no floor, no cap. At ANY item price the split is identical in shape —
 * Rs 10,000 item: buyer +50, seller 50, dealer 40, platform 60, seller keeps 9,950.
 *
 * The inspection bid is buyer-set and is NOT part of this module: the platform takes no cut of
 * it, so it never enters the fee engine (see `docs/DECISIONS.md` section 5).
 *
 * These rates are configuration, not constants, in the running system (`pricing_config`), so a
 * rate change does not require a code change. This module holds the confirmed defaults.
 */

import { type Money, bpsOf, assertMoney, add, sub } from './money.ts';

export const BPS = {
  /** 0.5% */
  buyerFee: 50,
  /** 0.5% */
  sellerFee: 50,
  /** 0.4% */
  dealerBonus: 40,
} as const;

export type PricingConfig = {
  buyerFeeBps: number;
  sellerFeeBps: number;
  dealerBonusBps: number;
};

export const CONFIRMED_PRICING: PricingConfig = {
  buyerFeeBps: BPS.buyerFee,
  sellerFeeBps: BPS.sellerFee,
  dealerBonusBps: BPS.dealerBonus,
};

/**
 * One-sided percentage of the sale price. Pure rate — no floor, no cap — so the calculator
 * shows the real percentage at every item price.
 *
 * A Rs 0 sale yields Rs 0: a zero-price sale is a fraud signal handled upstream, not a
 * transaction to be charged. See docs/06 section 3.1.
 */
export function sideFee(salePriceMinor: Money, bps: number): Money {
  assertMoney(salePriceMinor, 'salePrice');
  if (salePriceMinor === 0) return 0;
  return bpsOf(salePriceMinor, bps);
}

export function buyerSuccessFee(salePrice: Money, cfg: PricingConfig = CONFIRMED_PRICING): Money {
  return sideFee(salePrice, cfg.buyerFeeBps);
}

export function sellerSuccessFee(salePrice: Money, cfg: PricingConfig = CONFIRMED_PRICING): Money {
  return sideFee(salePrice, cfg.sellerFeeBps);
}

/**
 * The dealer's success bonus: 0.4% of price = 40% of the 1% fee pool the buyer and seller
 * contribute. Deliberately NOT a share of the collected fees at settlement — the split is fixed
 * at pricing time so both sides see the same numbers. Plus the bid, in full.
 */
export function dealerSuccessBonus(salePrice: Money, cfg: PricingConfig = CONFIRMED_PRICING): Money {
  return sideFee(salePrice, cfg.dealerBonusBps);
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

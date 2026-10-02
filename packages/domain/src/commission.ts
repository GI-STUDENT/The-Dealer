/**
 * The success-fee eligibility guard. This is the highest-risk logic in the system.
 *
 * Hard invariant: **success fees exist only when money moves.** No closed sale means no buyer
 * 5%, no seller 3%, no dealer bonus, and no company revenue. See `docs/DECISIONS.md` section 3.
 *
 * This module is the first of three independent layers (docs/06 section 3.2):
 *   1. this application guard,
 *   2. the database trigger `ledger_commission_guard`, and
 *   3. the nightly reconciliation view `v_commission_anomaly`.
 * A bug in any one of them must not leak money. This one is unit-tested exhaustively.
 */

import { type Money, assertMoney } from './money.ts';
import { type PricingConfig, CONFIRMED_PRICING, pricingBreakdown } from './pricing.ts';

/** States in which no sale occurred and no success fee may ever be charged. */
export const NON_SALE_STATES = [
  'deal_failed',
  'purchase_cancelled',
  'buyer_rejected',
  'aborted_unsafe',
  'agent_no_show',
  'buyer_abandoned',
  'bid_refunded',
  'expired_request',
  'cancelled_by_buyer',
] as const;

export type NonSaleState = (typeof NON_SALE_STATES)[number];

export type TransactionSnapshot = {
  publicRef: string;
  state: string;
  /** The price both sides agreed on camera. Reference only; never touches our ledger. */
  purchasePriceMinor: Money;
  /** The ONLY timestamp that makes success fees chargeable. */
  purchaseCompletedAt: string | null;
  buyerConfirmedAt: string | null;
  disputeWindowEndsAt: string | null;
  hasOpenDispute: boolean;
};

export type IneligibleReason =
  | 'PURCHASE_NOT_COMPLETED'
  | 'ZERO_PURCHASE_PRICE'
  | 'TRANSACTION_NOT_CLOSED'
  | 'OPEN_DISPUTE'
  | 'NO_DISPUTE_WINDOW'
  | 'DISPUTE_WINDOW_OPEN'
  | 'BUYER_HAS_NOT_CONFIRMED';

export type CommissionDecision =
  | { eligible: false; reason: IneligibleReason }
  | {
      eligible: true;
      salePrice: Money;
      buyerFee: Money;
      sellerFee: Money;
      totalFees: Money;
      dealerBonus: Money;
      companyTake: Money;
    };

function isNonSaleState(state: string): state is NonSaleState {
  return (NON_SALE_STATES as readonly string[]).includes(state);
}

/**
 * Evaluate whether the success fees may be charged, and if so, compute them.
 *
 * `now` is injected rather than read from the clock so the result is deterministic under test.
 */
export function evaluateCommission(
  txn: TransactionSnapshot,
  now: Date,
  cfg: PricingConfig = CONFIRMED_PRICING,
): CommissionDecision {
  if (txn.purchaseCompletedAt === null) {
    return { eligible: false, reason: 'PURCHASE_NOT_COMPLETED' };
  }
  if (isNonSaleState(txn.state)) {
    return { eligible: false, reason: 'TRANSACTION_NOT_CLOSED' };
  }
  assertMoney(txn.purchasePriceMinor, 'purchasePrice');
  if (txn.purchasePriceMinor === 0) {
    return { eligible: false, reason: 'ZERO_PURCHASE_PRICE' };
  }
  if (txn.hasOpenDispute) {
    return { eligible: false, reason: 'OPEN_DISPUTE' };
  }
  if (txn.disputeWindowEndsAt === null) {
    return { eligible: false, reason: 'NO_DISPUTE_WINDOW' };
  }
  if (now.getTime() < new Date(txn.disputeWindowEndsAt).getTime()) {
    return { eligible: false, reason: 'DISPUTE_WINDOW_OPEN' };
  }
  if (txn.buyerConfirmedAt === null) {
    return { eligible: false, reason: 'BUYER_HAS_NOT_CONFIRMED' };
  }

  const b = pricingBreakdown(txn.purchasePriceMinor, cfg);
  return {
    eligible: true,
    salePrice: b.salePrice,
    buyerFee: b.buyerFee,
    sellerFee: b.sellerFee,
    totalFees: b.totalFees,
    dealerBonus: b.dealerBonus,
    companyTake: b.companyTake,
  };
}

// ---------------------------------------------------------------------------------------------
// Bid settlement on a transaction that does NOT close.
// The dealer is still paid for the work, but there is no success fee of any kind.
// Mirrors docs/DECISIONS.md section 3.
// ---------------------------------------------------------------------------------------------

export type FailureOutcome =
  | 'honest_reject'
  | 'seller_fraud'
  | 'price_exceeds_limit'
  | 'seller_fee_refused'
  | 'seller_unavailable'
  | 'inspector_unsafe'
  | 'inspector_no_show';

export type BidSettlement = {
  /** Fraction of the inspection bid returned to the dealer, in basis points. */
  dealerBidShareBps: number;
  dealerBidAmount: Money;
  buyerRefund: Money;
  /** Realised success fees and bonus. Always zero on these paths. */
  buyerFee: Money;
  sellerFee: Money;
  dealerBonus: Money;
  companyTake: Money;
};

/** 7000 bps = 70%. The dealer did the work even though no sale followed. */
export const FAILED_DEAL_DEALER_SHARE_BPS = 7_000;
/** 10000 bps = 100%. The inspector left for their own safety; pay them in full. */
export const UNSAFE_DEALER_SHARE_BPS = 10_000;

export function settleFailedDeal(
  outcome: FailureOutcome,
  inspectionBid: Money,
): BidSettlement {
  assertMoney(inspectionBid, 'inspectionBid');

  let shareBps: number;
  switch (outcome) {
    case 'inspector_unsafe':
      shareBps = UNSAFE_DEALER_SHARE_BPS;
      break;
    case 'inspector_no_show':
      shareBps = 0; // the buyer gets a full refund; the platform eats the provider cost
      break;
    default:
      shareBps = FAILED_DEAL_DEALER_SHARE_BPS;
  }

  const dealerBidAmount = Math.floor((inspectionBid * shareBps) / 10_000);
  return {
    dealerBidShareBps: shareBps,
    dealerBidAmount,
    buyerRefund: inspectionBid - dealerBidAmount,
    buyerFee: 0,
    sellerFee: 0,
    dealerBonus: 0,
    companyTake: 0,
  };
}

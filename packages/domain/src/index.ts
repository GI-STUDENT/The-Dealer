/**
 * @had/domain — the pure business core.
 *
 * Everything here is deterministic, dependency-free, and I/O-free. That is deliberate: this is
 * where the money is calculated and the state machine is defined, so it must be testable without
 * a database, a network, or a clock. Time is injected; amounts are integers; nothing is random.
 */

export * as money from './money.ts';
export * as pricing from './pricing.ts';
export * as bid from './bid.ts';
export * as commission from './commission.ts';
export * as state from './state.ts';

export {
  type Money,
  MoneyError,
  assertMoney,
  add,
  sub,
  pkr,
  toRupees,
  formatPkr,
  bpsOf,
  clamp,
} from './money.ts';

export {
  type PricingConfig,
  type PricingBreakdown,
  BPS,
  CONFIRMED_PRICING,
  sideFee,
  buyerSuccessFee,
  sellerSuccessFee,
  dealerSuccessBonus,
  companyTake,
  pricingBreakdown,
  buyerTotalOverSticker,
} from './pricing.ts';

export {
  type Band,
  type BandInput,
  type BidCheck,
  type Category,
  CATEGORY_BASE_PKR,
  suggestedBand,
  checkBid,
  categoryBase,
} from './bid.ts';

export {
  type TransactionSnapshot,
  type CommissionDecision,
  type BidSettlement,
  type FailureOutcome,
  NON_SALE_STATES,
  FAILED_DEAL_DEALER_SHARE_BPS,
  UNSAFE_DEALER_SHARE_BPS,
  evaluateCommission,
  settleFailedDeal,
} from './commission.ts';

export {
  type TxnState,
  type Transition,
  type TransitionResult,
  TXN_STATES,
  TERMINAL_STATES,
  TRANSITIONS,
  isTxnState,
  isTerminal,
  transition,
  assertTransition,
  IllegalTransitionError,
} from './state.ts';

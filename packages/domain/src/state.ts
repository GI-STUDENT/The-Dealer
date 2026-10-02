/**
 * The transaction state machine. Mirrors docs/03-state-machine.md.
 *
 * This module owns the SHAPE of the machine: which states exist, which events are legal from
 * which state, and which states are terminal. Guard evaluation (is the actor allowed, is the
 * evidence present) lives in the service layer, because it needs I/O — but a transition that is
 * not in this table can never be taken by anyone, including an admin.
 */

export const TXN_STATES = [
  // Phase 0 - request / bid
  'draft',
  'request_published',
  'response_received',
  'agent_selected',
  'awaiting_bid_payment',
  'bid_secured',
  'expired_request',
  'cancelled_by_buyer',
  // Phase 1 - travel
  'agent_en_route',
  'agent_arrived',
  // Phase 2 - verification gates
  'seller_identity_pending',
  'seller_identity_verified',
  'possession_pending',
  'possession_confirmed',
  'possession_failed',
  // Phase 3 - inspection
  'inspection_in_progress',
  'live_session_active',
  'inspection_reported',
  'live_session_ended',
  // Phase 4 - decision / negotiation
  'negotiation_open',
  'negotiation_waiting_buyer',
  'buyer_decision_pending',
  'buyer_rejected',
  // Phase 5 - purchase
  'purchase_authorized',
  'settlement_pending',
  'settlement_verified',
  'purchase_completed',
  'custody_verified',
  'purchase_cancelled',
  // Phase 6 - custody and logistics
  'item_collected',
  'packaged',
  'handover_pending',
  'in_transit',
  'delivered',
  // Phase 7 - close
  'buyer_confirmed_receipt',
  'dispute_window_elapsed',
  'commission_settled',
  'transaction_completed',
  // Failure / exceptional
  'dispute_opened',
  'dispute_resolved',
  'aborted_unsafe',
  'agent_no_show',
  'buyer_abandoned',
  'bid_refunded',
  'deal_failed',
] as const;

export type TxnState = (typeof TXN_STATES)[number];

const STATE_SET: ReadonlySet<string> = new Set(TXN_STATES);

export function isTxnState(value: string): value is TxnState {
  return STATE_SET.has(value);
}

export const TERMINAL_STATES: readonly TxnState[] = [
  'transaction_completed',
  'deal_failed',
  'bid_refunded',
  'expired_request',
  'cancelled_by_buyer',
  'buyer_rejected',
  'aborted_unsafe',
  'agent_no_show',
  'buyer_abandoned',
  'purchase_cancelled',
  'dispute_resolved',
] as const;

export function isTerminal(state: TxnState): boolean {
  return (TERMINAL_STATES as readonly string[]).includes(state);
}

export type Transition = {
  from: TxnState;
  event: string;
  to: TxnState | readonly TxnState[];
  /** Human-readable guard. The service layer enforces it; it is documented here. */
  guard?: string;
};

/**
 * The legal transition table. `to` may be a list where the outcome depends on a guard.
 * Anything not listed here is impossible.
 */
export const TRANSITIONS: readonly Transition[] = [
  // --- 0: request and bid -------------------------------------------------------------------
  { from: 'draft', event: 'request.publish', to: 'request_published',
    guard: 'category allowed and required fields and checklist>=1' },
  { from: 'draft', event: 'request.discard', to: 'cancelled_by_buyer', guard: 'actor=buyer' },
  { from: 'request_published', event: 'offer.respond', to: 'response_received',
    guard: 'actor=dealer and eligible and no conflict and responses<5' },
  { from: 'response_received', event: 'offer.respond', to: 'response_received',
    guard: 'actor=dealer and live and counter_round<=1' },
  { from: 'response_received', event: 'offer.select', to: 'agent_selected',
    guard: 'actor=buyer and a responding dealer is eligible' },
  { from: 'response_received', event: 'offer.expire', to: 'request_published',
    guard: 'all responses expired' },
  { from: 'request_published', event: 'request.expire', to: 'expired_request',
    guard: 'published_at + 14d' },
  { from: 'agent_selected', event: 'payment.bid.succeeded', to: 'bid_secured',
    guard: 'amount = request.bid_minor and provider signature valid' },
  { from: 'agent_selected', event: 'payment.bid.failed', to: 'awaiting_bid_payment' },
  { from: 'awaiting_bid_payment', event: 'payment.bid.succeeded', to: 'bid_secured',
    guard: 'idempotency key unused' },
  { from: 'awaiting_bid_payment', event: 'bid.expire', to: 'cancelled_by_buyer',
    guard: 'selected_at + 2h' },

  // --- 1: travel ----------------------------------------------------------------------------
  { from: 'bid_secured', event: 'agent.enroute', to: 'agent_en_route', guard: 'actor=dealer' },
  { from: 'bid_secured', event: 'agent.checkin', to: 'agent_arrived',
    guard: 'GPS within service area and accuracy<=100m' },
  { from: 'agent_en_route', event: 'agent.checkin', to: 'agent_arrived' },
  { from: 'bid_secured', event: 'agent.no_show.expire', to: 'agent_no_show',
    guard: 'accepted_at + 4h and no check-in' },

  // --- 2: verification gates ----------------------------------------------------------------
  { from: 'agent_arrived', event: 'seller.identity.begin', to: 'seller_identity_pending',
    guard: 'actor=dealer' },
  { from: 'seller_identity_pending', event: 'seller.identity.capture', to: 'seller_identity_verified',
    guard: 'ID image and consent and name+phone AND seller acknowledges 3% fee on camera' },
  { from: 'seller_identity_pending', event: 'seller.fee.declined', to: 'deal_failed',
    guard: 'seller refuses the 3% fee' },
  { from: 'seller_identity_pending', event: 'seller.absent.expire', to: 'deal_failed',
    guard: 'wait >= 30 min logged' },
  { from: 'seller_identity_verified', event: 'possession.begin', to: 'possession_pending' },
  { from: 'possession_pending', event: 'possession.submit',
    to: ['possession_confirmed', 'possession_failed'], guard: 'reviewer verdict recorded' },
  { from: 'possession_failed', event: 'possession.fail', to: 'deal_failed',
    guard: 'dealer could not establish possession or control' },
  { from: 'seller_identity_verified', event: 'seller.absent.expire', to: 'deal_failed',
    guard: 'wait >= 30 min logged' },
  { from: 'possession_confirmed', event: 'inspection.start', to: 'inspection_in_progress',
    guard: 'actor=dealer and category clearance' },

  // --- 3: inspection ------------------------------------------------------------------------
  { from: 'inspection_in_progress', event: 'live_session.start', to: 'live_session_active' },
  { from: 'live_session_active', event: 'live_session.end', to: ['inspection_in_progress', 'inspection_reported'],
    guard: 'duration <= 60 min' },
  { from: 'inspection_in_progress', event: 'inspection.submit', to: 'inspection_reported',
    guard: 'all checklist addressed and >=1 whole-item photo and verdict set' },
  { from: 'inspection_reported', event: 'live_session.start', to: 'live_session_active' },
  { from: 'inspection_reported', event: 'live_session.end', to: 'live_session_ended' },
  { from: 'live_session_ended', event: 'inspection.finalize', to: 'inspection_reported' },

  // --- 4: decision and negotiation ----------------------------------------------------------
  { from: 'inspection_reported', event: 'negotiation.open', to: 'negotiation_open',
    guard: 'negotiation_enabled and actor=dealer' },
  { from: 'inspection_reported', event: 'buyer.decide', to: 'buyer_decision_pending',
    guard: 'any verdict' },
  { from: 'negotiation_open', event: 'negotiation.counter', to: 'negotiation_open' },
  { from: 'negotiation_open', event: 'negotiation.accept', to: 'buyer_decision_pending',
    guard: 'price<=ceiling' },
  { from: 'negotiation_open', event: 'negotiation.breach', to: 'negotiation_waiting_buyer',
    guard: 'price>ceiling' },
  { from: 'negotiation_waiting_buyer', event: 'buyer.override', to: 'negotiation_open',
    guard: 'records new ceiling' },
  { from: 'buyer_decision_pending', event: 'buyer.approve', to: 'purchase_authorized',
    guard: 'price<=ceiling and actor=buyer' },
  { from: 'buyer_decision_pending', event: 'buyer.reject', to: 'buyer_rejected',
    guard: 'reason required' },
  { from: 'buyer_decision_pending', event: 'buyer.counter', to: 'negotiation_open' },

  // --- 5: purchase --------------------------------------------------------------------------
  { from: 'purchase_authorized', event: 'settlement.start', to: 'settlement_pending',
    guard: 'bid settled and both fee amounts computed server-side' },
  { from: 'settlement_pending', event: 'payment.buyer_success_fee.succeeded', to: 'settlement_pending' },
  { from: 'settlement_pending', event: 'payment.seller_success_fee.collected', to: 'settlement_pending' },
  { from: 'settlement_pending', event: 'settlement.seller_paid', to: 'settlement_verified',
    guard: 'evidence>=1 and price<=ceiling' },
  { from: 'settlement_pending', event: 'settlement.timeout', to: 'deal_failed', guard: '+6h' },
  { from: 'settlement_verified', event: 'purchase.complete', to: 'purchase_completed',
    guard: 'price recorded and receipt captured' },
  { from: 'purchase_completed', event: 'custody.serial_verify', to: 'custody_verified',
    guard: 'serial hash match' },
  { from: 'purchase_completed', event: 'custody.serial_verify', to: 'dispute_opened',
    guard: 'serial mismatch' },

  // --- 6: custody and logistics -------------------------------------------------------------
  { from: 'custody_verified', event: 'item.collect', to: 'item_collected' },
  { from: 'item_collected', event: 'item.package', to: 'packaged' },
  { from: 'packaged', event: 'handover.begin', to: 'handover_pending' },
  { from: 'handover_pending', event: 'handover.confirm', to: 'in_transit' },
  { from: 'in_transit', event: 'delivery.confirm', to: 'delivered' },

  // --- 7: close -----------------------------------------------------------------------------
  { from: 'delivered', event: 'buyer.confirm_receipt', to: 'buyer_confirmed_receipt' },
  { from: 'buyer_confirmed_receipt', event: 'dispute.window_elapse', to: 'dispute_window_elapsed',
    guard: '72h and no open dispute' },
  { from: 'dispute_window_elapsed', event: 'commission.settle', to: 'commission_settled',
    guard: 'fee eligibility guard passes' },
  { from: 'commission_settled', event: 'transaction.close', to: 'transaction_completed' },

  // --- exceptional --------------------------------------------------------------------------
  { from: 'dispute_opened', event: 'dispute.resolve', to: 'dispute_resolved' },
];

export type TransitionResult =
  | { ok: true; to: TxnState; ambiguous: boolean }
  | { ok: false; reason: 'UNKNOWN_STATE' | 'NO_SUCH_TRANSITION' };

/**
 * Look up whether `event` may move `from` to a next state.
 * When the table lists several possible destinations the result is flagged `ambiguous` and the
 * caller must resolve it with a guard.
 */
export function transition(from: string, event: string): TransitionResult {
  if (!isTxnState(from)) return { ok: false, reason: 'UNKNOWN_STATE' };
  const matches = TRANSITIONS.filter((t) => t.from === from && t.event === event);
  if (matches.length === 0) return { ok: false, reason: 'NO_SUCH_TRANSITION' };
  const first = matches[0].to;
  const firstIsList = Array.isArray(first);
  return {
    ok: true,
    to: (firstIsList ? first[0] : first) as TxnState,
    ambiguous: matches.length > 1 || firstIsList,
  };
}

export class IllegalTransitionError extends Error {
  readonly from: string;
  readonly event: string;

  constructor(from: string, event: string) {
    super(`Illegal transition: ${from} --[${event}]-->`);
    this.name = 'IllegalTransitionError';
    this.from = from;
    this.event = event;
  }
}

export function assertTransition(from: TxnState, event: string): TxnState {
  const r = transition(from, event);
  if (!r.ok) throw new IllegalTransitionError(from, event);
  return r.to;
}

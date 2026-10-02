import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  TXN_STATES,
  TERMINAL_STATES,
  TRANSITIONS,
  isTxnState,
  isTerminal,
  transition,
  assertTransition,
  IllegalTransitionError,
  type TxnState,
} from '../src/state.ts';

const STATE_SET = new Set<string>(TXN_STATES);

describe('state — the shape of the machine is self-consistent', () => {
  test('state names are unique', () => {
    assert.equal(STATE_SET.size, TXN_STATES.length);
  });

  test('every transition endpoint is a real state', () => {
    for (const t of TRANSITIONS) {
      assert.ok(STATE_SET.has(t.from), `unknown from: ${t.from}`);
      const tos = Array.isArray(t.to) ? t.to : [t.to];
      for (const to of tos) assert.ok(STATE_SET.has(to), `unknown to: ${to}`);
    }
  });

  test('terminal states have no outgoing transitions', () => {
    for (const s of TERMINAL_STATES) {
      const out = TRANSITIONS.filter((t) => t.from === s);
      assert.equal(out.length, 0, `terminal state ${s} can still move`);
    }
  });

  test('no non-terminal state is a dead end', () => {
    for (const s of TXN_STATES) {
      if (isTerminal(s)) continue;
      const out = TRANSITIONS.filter((t) => t.from === s);
      assert.ok(out.length > 0, `non-terminal state ${s} has no outgoing transition`);
    }
  });

  test('isTxnState and isTerminal behave', () => {
    assert.equal(isTxnState('bid_secured'), true);
    assert.equal(isTxnState('not_a_state'), false);
    assert.equal(isTerminal('transaction_completed'), true);
    assert.equal(isTerminal('bid_secured'), false);
  });
});

describe('state — the commission gate cannot be reached without a sale', () => {
  test('the ONLY transition into commission_settled comes from dispute_window_elapsed', () => {
    const into = TRANSITIONS.filter((t) => {
      const tos = Array.isArray(t.to) ? t.to : [t.to];
      return tos.includes('commission_settled');
    });
    assert.equal(into.length, 1);
    assert.equal(into[0].from, 'dispute_window_elapsed');
  });

  test('no pre-purchase state can jump to settlement or completion', () => {
    const forbidden = new Set(['settlement_pending', 'settlement_verified', 'purchase_completed', 'custody_verified', 'commission_settled', 'transaction_completed']);
    for (const t of TRANSITIONS) {
      const tos = Array.isArray(t.to) ? t.to : [t.to];
      for (const to of tos) {
        if (!forbidden.has(to)) continue;
        assert.ok(
          !['draft', 'request_published', 'response_received', 'agent_selected', 'awaiting_bid_payment', 'bid_secured', 'agent_en_route', 'agent_arrived'].includes(t.from),
          `${t.from} --[${t.event}]--> ${to} skips verification`,
        );
      }
    }
  });
});

describe('state — transition() lookups', () => {
  test('a single-destination transition resolves unambiguously', () => {
    const r = transition('draft', 'request.publish');
    assert.deepEqual(r, { ok: true, to: 'request_published', ambiguous: false });
  });

  test('an unknown state is reported', () => {
    assert.deepEqual(transition('nowhere', 'x'), { ok: false, reason: 'UNKNOWN_STATE' });
  });

  test('a state with no such event is reported', () => {
    assert.deepEqual(transition('draft', 'agent.enroute'), { ok: false, reason: 'NO_SUCH_TRANSITION' });
  });

  test('a multi-destination transition is flagged ambiguous', () => {
    const r = transition('possession_pending', 'possession.submit');
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.ambiguous, true);
  });
});

describe('state — the full happy path walks start to finish', () => {
  test('every step is legal', () => {
    const path: Array<[TxnState, string]> = [
      ['draft', 'request.publish'],
      ['request_published', 'offer.respond'],
      ['response_received', 'offer.select'],
      ['agent_selected', 'payment.bid.succeeded'],
      ['bid_secured', 'agent.checkin'],
      ['agent_arrived', 'seller.identity.begin'],
      ['seller_identity_pending', 'seller.identity.capture'],
      ['seller_identity_verified', 'possession.begin'],
      ['possession_pending', 'possession.submit'],
      ['possession_confirmed', 'inspection.start'],
      ['inspection_in_progress', 'inspection.submit'],
      ['inspection_reported', 'buyer.decide'],
      ['buyer_decision_pending', 'buyer.approve'],
      ['purchase_authorized', 'settlement.start'],
      ['settlement_pending', 'settlement.seller_paid'],
      ['settlement_verified', 'purchase.complete'],
      ['purchase_completed', 'custody.serial_verify'],
      ['custody_verified', 'item.collect'],
      ['item_collected', 'item.package'],
      ['packaged', 'handover.begin'],
      ['handover_pending', 'handover.confirm'],
      ['in_transit', 'delivery.confirm'],
      ['delivered', 'buyer.confirm_receipt'],
      ['buyer_confirmed_receipt', 'dispute.window_elapse'],
      ['dispute_window_elapsed', 'commission.settle'],
      ['commission_settled', 'transaction.close'],
    ];
    let current: TxnState = 'draft';
    for (const [from, event] of path) {
      assert.equal(current, from, `path out of sync before ${event}`);
      current = assertTransition(from, event);
    }
    assert.equal(current, 'transaction_completed');
    assert.equal(isTerminal(current), true);
  });
});

describe('state — illegal moves throw', () => {
  test('assertTransition throws a typed error', () => {
    assert.throws(() => assertTransition('draft', 'commission.settle'), IllegalTransitionError);
  });

  test('the error carries the attempted edge', () => {
    try {
      assertTransition('bid_secured', 'delivery.confirm');
      assert.fail('should have thrown');
    } catch (e) {
      assert.ok(e instanceof IllegalTransitionError);
      assert.equal(e.from, 'bid_secured');
      assert.equal(e.event, 'delivery.confirm');
    }
  });
});

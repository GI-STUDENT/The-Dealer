import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { pkr } from '../src/money.ts';
import {
  evaluateCommission,
  settleFailedDeal,
  NON_SALE_STATES,
  type TransactionSnapshot,
  type FailureOutcome,
} from '../src/commission.ts';

/**
 * The single most important property in the system: NO SUCCESS FEE UNLESS MONEY MOVED.
 * These tests exist to make that property hard to break by accident.
 */

const NOW = new Date('2026-06-10T00:00:00Z');

const validSnapshot: TransactionSnapshot = {
  publicRef: 'FA-AAAA1111',
  state: 'dispute_window_elapsed',
  purchasePriceMinor: pkr(150_000),
  purchaseCompletedAt: '2026-06-01T00:00:00Z',
  buyerConfirmedAt: '2026-06-02T00:00:00Z',
  disputeWindowEndsAt: '2026-06-05T00:00:00Z',
  hasOpenDispute: false,
};

describe('commission — the happy path', () => {
  test('a completed, confirmed, undisputed sale charges the confirmed fees', () => {
    const d = evaluateCommission(validSnapshot, NOW);
    assert.equal(d.eligible, true);
    if (!d.eligible) return;
    assert.equal(d.buyerFee, pkr(7_500));
    assert.equal(d.sellerFee, pkr(4_500));
    assert.equal(d.totalFees, pkr(12_000));
    assert.equal(d.dealerBonus, pkr(3_000));
    assert.equal(d.companyTake, pkr(9_000));
  });
});

describe('commission — every reason it must refuse', () => {
  test('purchase not completed', () => {
    const d = evaluateCommission({ ...validSnapshot, purchaseCompletedAt: null }, NOW);
    assert.deepEqual(d, { eligible: false, reason: 'PURCHASE_NOT_COMPLETED' });
  });

  test('a zero purchase price is refused', () => {
    const d = evaluateCommission({ ...validSnapshot, purchasePriceMinor: 0 }, NOW);
    assert.deepEqual(d, { eligible: false, reason: 'ZERO_PURCHASE_PRICE' });
  });

  test('an open dispute is refused', () => {
    const d = evaluateCommission({ ...validSnapshot, hasOpenDispute: true }, NOW);
    assert.deepEqual(d, { eligible: false, reason: 'OPEN_DISPUTE' });
  });

  test('a missing dispute window is refused', () => {
    const d = evaluateCommission({ ...validSnapshot, disputeWindowEndsAt: null }, NOW);
    assert.deepEqual(d, { eligible: false, reason: 'NO_DISPUTE_WINDOW' });
  });

  test('a running dispute window is refused', () => {
    const d = evaluateCommission(validSnapshot, new Date('2026-06-04T00:00:00Z'));
    assert.deepEqual(d, { eligible: false, reason: 'DISPUTE_WINDOW_OPEN' });
  });

  test('the window closes exactly at its end timestamp', () => {
    const d = evaluateCommission(validSnapshot, new Date('2026-06-05T00:00:00Z'));
    assert.equal(d.eligible, true, 'must be chargeable AT the boundary, not one instant later');
  });

  test('buyer has not confirmed receipt', () => {
    const d = evaluateCommission({ ...validSnapshot, buyerConfirmedAt: null }, NOW);
    assert.deepEqual(d, { eligible: false, reason: 'BUYER_HAS_NOT_CONFIRMED' });
  });
});

describe('commission — the hard invariant, no fee on a non-sale', () => {
  test('EVERY non-sale state is refused, even with a purchaseCompletedAt timestamp', () => {
    for (const state of NON_SALE_STATES) {
      const d = evaluateCommission({ ...validSnapshot, state }, NOW);
      assert.equal(d.eligible, false, `state ${state} must never be chargeable`);
    }
  });

  test('a failed state with no purchase timestamp is refused at the first check', () => {
    const d = evaluateCommission(
      { ...validSnapshot, state: 'deal_failed', purchaseCompletedAt: null },
      NOW,
    );
    assert.deepEqual(d, { eligible: false, reason: 'PURCHASE_NOT_COMPLETED' });
  });

  test('the function never returns a positive fee for any refusal', () => {
    const refusals = [
      { ...validSnapshot, purchaseCompletedAt: null },
      { ...validSnapshot, purchasePriceMinor: 0 },
      { ...validSnapshot, hasOpenDispute: true },
      { ...validSnapshot, disputeWindowEndsAt: null },
      { ...validSnapshot, buyerConfirmedAt: null },
      { ...validSnapshot, state: 'deal_failed' },
    ];
    for (const s of refusals) {
      const d = evaluateCommission(s, NOW);
      assert.equal(d.eligible, false);
      assert.ok(!('buyerFee' in d), 'a refusal must not carry fee fields');
    }
  });
});

describe('commission — bid settlement when the deal does not close', () => {
  const BID = pkr(1_500);

  test('an honest rejection pays the dealer 70% and refunds the buyer 30%', () => {
    const s = settleFailedDeal('honest_reject', BID);
    assert.equal(s.dealerBidShareBps, 7_000);
    assert.equal(s.dealerBidAmount, pkr(1_050));
    assert.equal(s.buyerRefund, pkr(450));
  });

  test('an unsafe aborted job pays the dealer 100%', () => {
    const s = settleFailedDeal('inspector_unsafe', BID);
    assert.equal(s.dealerBidAmount, pkr(1_500));
    assert.equal(s.buyerRefund, pkr(0));
  });

  test('a no-show by the inspector refunds the buyer in full', () => {
    const s = settleFailedDeal('inspector_no_show', BID);
    assert.equal(s.dealerBidAmount, 0);
    assert.equal(s.buyerRefund, pkr(1_500));
  });

  test('EVERY failure outcome produces zero success fees, zero bonus, zero company take', () => {
    const outcomes: FailureOutcome[] = [
      'honest_reject', 'seller_fraud', 'price_exceeds_limit',
      'seller_fee_refused', 'seller_unavailable', 'inspector_unsafe', 'inspector_no_show',
    ];
    for (const o of outcomes) {
      const s = settleFailedDeal(o, BID);
      assert.equal(s.buyerFee, 0, `${o}: buyer fee`);
      assert.equal(s.sellerFee, 0, `${o}: seller fee`);
      assert.equal(s.dealerBonus, 0, `${o}: dealer bonus`);
      assert.equal(s.companyTake, 0, `${o}: company take`);
    }
  });

  test('the bid is always conserved between the dealer and the refund', () => {
    const outcomes: FailureOutcome[] = [
      'honest_reject', 'seller_fraud', 'price_exceeds_limit',
      'seller_fee_refused', 'seller_unavailable', 'inspector_unsafe', 'inspector_no_show',
    ];
    for (const bid of [pkr(500), pkr(1_500), pkr(9_999)]) {
      for (const o of outcomes) {
        const s = settleFailedDeal(o, bid);
        assert.equal(s.dealerBidAmount + s.buyerRefund, bid, `${o} at ${bid}`);
      }
    }
  });
});

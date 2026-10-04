import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { pkr, toRupees } from '../src/money.ts';
import {
  buyerSuccessFee,
  sellerSuccessFee,
  dealerSuccessBonus,
  companyTake,
  pricingBreakdown,
  buyerTotalOverSticker,
  CONFIRMED_PRICING,
} from '../src/pricing.ts';

describe('pricing — the confirmed worked examples', () => {
  // These are the exact figures in docs/DECISIONS.md section 2.2 and docs/06 section 2.1.
  // If a code change breaks one of these, the business model changed. That must be deliberate.

  test('Rs 150,000 phone: the canonical example', () => {
    const p = pkr(150_000);
    assert.deepEqual(pricingBreakdown(p), {
      salePrice: p,
      buyerFee: pkr(750), // 0.5%
      sellerFee: pkr(750), // 0.5%
      totalFees: pkr(1_500), // 1% fee pool
      dealerBonus: pkr(600), // 0.4% = 40% of the pool
      companyTake: pkr(900), // 0.6% = 60% of the pool
    });
    // The bonus is 0.4%; adding the Rs 1,500 inspection bid lands the dealer at Rs 2,100.
    assert.equal(buyerSuccessFee(p) + sellerSuccessFee(p) - companyTake(p), pkr(600));
    assert.equal(buyerSuccessFee(p) + sellerSuccessFee(p) - companyTake(p) + pkr(1_500), pkr(2_100));
  });

  test('Rs 10,000 item: the exact shape of the confirmed split', () => {
    const p = pkr(10_000);
    assert.deepEqual(pricingBreakdown(p), {
      salePrice: p,
      buyerFee: pkr(50), // 0.5%
      sellerFee: pkr(50), // 0.5%
      totalFees: pkr(100), // 1% fee pool
      dealerBonus: pkr(40), // 0.4% = 40% of the 100 fee pool
      companyTake: pkr(60), // 0.6% = 60% of the 100 fee pool
    });
    // Seller keeps 99.5% of price: 10,000 - 50.
    assert.equal(p - sellerSuccessFee(p), pkr(9_950));
  });

  test('Rs 500,000 item: no floor, no cap — the rates hold at any price', () => {
    const p = pkr(500_000);
    assert.deepEqual(pricingBreakdown(p), {
      salePrice: p,
      buyerFee: pkr(2_500), // 0.5%
      sellerFee: pkr(2_500), // 0.5%
      totalFees: pkr(5_000), // 1%
      dealerBonus: pkr(2_000), // 0.4%
      companyTake: pkr(3_000), // 0.6%
    });
    assert.equal(companyTake(p), Math.round(p * 0.006), 'company take is exactly 0.6%');
  });

  test('Rs 40,000 laptop', () => {
    const p = pkr(40_000);
    assert.equal(buyerSuccessFee(p), pkr(200));
    assert.equal(sellerSuccessFee(p), pkr(200));
    assert.equal(dealerSuccessBonus(p), pkr(160), '0.4% = 160');
    assert.equal(companyTake(p), pkr(240));
  });

  test('a Rs 0 sale is never charged, and never floored', () => {
    assert.equal(buyerSuccessFee(0), 0);
    assert.equal(sellerSuccessFee(0), 0);
    assert.equal(dealerSuccessBonus(0), 0);
    assert.equal(companyTake(0), 0);
  });
});

describe('pricing — invariants', () => {
  const prices = [
    0, 1, 100, pkr(500), pkr(1_000), pkr(1_500), pkr(5_000), pkr(15_000),
    pkr(25_000), pkr(40_000), pkr(100_000), pkr(150_000), pkr(300_000),
    pkr(500_000), pkr(1_000_000), 123_456_789,
  ];

  test('companyTake always equals buyer + seller - dealer (no paisa lost or created)', () => {
    for (const p of prices) {
      const b = pricingBreakdown(p);
      assert.equal(
        b.companyTake,
        b.buyerFee + b.sellerFee - b.dealerBonus,
        `reconciliation failed at ${p}`,
      );
    }
  });

  test('all fees are non-negative integers', () => {
    for (const p of prices) {
      const b = pricingBreakdown(p);
      for (const [k, v] of Object.entries(b)) {
        assert.ok(Number.isSafeInteger(v), `${k} not a safe integer at ${p}`);
        assert.ok(v >= 0, `${k} negative at ${p}`);
      }
    }
  });

  test('every side fee is monotone non-decreasing in sale price', () => {
    const sorted = [...prices].sort((a, b) => a - b);
    let lastBuyer = -1;
    let lastSeller = -1;
    let lastDealer = -1;
    for (const p of sorted) {
      const buyer = buyerSuccessFee(p);
      const seller = sellerSuccessFee(p);
      const dealer = dealerSuccessBonus(p);
      assert.ok(buyer >= lastBuyer, `buyer fee decreased at ${p}`);
      assert.ok(seller >= lastSeller, `seller fee decreased at ${p}`);
      assert.ok(dealer >= lastDealer, `dealer bonus decreased at ${p}`);
      lastBuyer = buyer;
      lastSeller = seller;
      lastDealer = dealer;
    }
  });

  test('every fee is exactly its rate at every price (no floors, no caps)', () => {
    for (const p of prices) {
      if (p === 0) continue;
      assert.equal(buyerSuccessFee(p), Math.round(p * 0.005), `buyer 0.5% at ${p}`);
      assert.equal(sellerSuccessFee(p), Math.round(p * 0.005), `seller 0.5% at ${p}`);
      assert.equal(dealerSuccessBonus(p), Math.round(p * 0.004), `dealer 0.4% at ${p}`);
      // Buyer + seller - dealer, so it equals 0.6% only up to paisa rounding.
      assert.equal(companyTake(p), 2 * Math.round(p * 0.005) - Math.round(p * 0.004), `company at ${p}`);
      assert.ok(Math.abs(companyTake(p) - Math.round(p * 0.006)) <= 1, `company ~0.6% at ${p}`);
    }
  });

  test('the 1% fee pool splits 40% to the dealer and 60% to the platform', () => {
    for (const p of prices) {
      if (p === 0) continue;
      const b = pricingBreakdown(p);
      assert.ok(Math.abs(b.dealerBonus - Math.round(b.totalFees * 0.4)) <= 1, `dealer 40% at ${p}`);
      assert.ok(Math.abs(b.companyTake - Math.round(b.totalFees * 0.6)) <= 1, `platform 60% at ${p}`);
    }
  });

  test('the dealer bonus never exceeds the fees collected', () => {
    for (const p of prices) {
      const b = pricingBreakdown(p);
      assert.ok(b.dealerBonus <= b.totalFees, `dealer bonus exceeds fees at ${p}`);
      assert.ok(b.companyTake >= 0, `negative company take at ${p}`);
    }
  });

  test('buyerTotalOverSticker = buyer fee + bid (seller fee is not the buyer cost)', () => {
    assert.equal(buyerTotalOverSticker(pkr(150_000), pkr(1_500)), pkr(2_250));
    // 152,250 total spend on a 150,000 item = 1.5% over sticker.
    assert.equal(toRupees(buyerTotalOverSticker(pkr(150_000), pkr(1_500))), 2_250);
  });

  test('the company nets a positive contribution across the v1 price range', () => {
    // PLACEHOLDER cost model. docs/06 section 2.1 still describes the economics of the old
    // 10% pool (PSP 3.5% of fees, ops Rs 120/txn, reserve 1.2% of price) — a 1.2% reserve is
    // larger than the whole 0.6% company take, so those numbers must be re-derived for the 1%
    // pool before they are asserted here. Interim: PSP 3.5% of fees, ops Rs 10/txn, reserve
    // 0.1% of price.
    const ops = pkr(10);
    for (const p of prices) {
      if (p < pkr(10_000)) continue;
      const b = pricingBreakdown(p);
      const psp = Math.round(b.totalFees * 0.035);
      const reserve = Math.round(p * 0.001);
      const contribution = b.companyTake - psp - ops - reserve;
      assert.ok(contribution > 0, `platform loses money at Rs ${toRupees(p)}`);
    }
  });
});

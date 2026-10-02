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
      buyerFee: pkr(7_500), // 5%
      sellerFee: pkr(4_500), // 3%
      totalFees: pkr(12_000),
      dealerBonus: pkr(3_000), // 2%
      companyTake: pkr(9_000), // 6%
    });
    // The bonus is 2%; adding the Rs 1,500 inspection bid lands the dealer at Rs 4,500,
    // exactly what a flat 3% of the sale would have paid, for the same ~2.5 hours of work.
    assert.equal(buyerSuccessFee(p) + sellerSuccessFee(p) - companyTake(p), pkr(3_000));
    assert.equal(buyerSuccessFee(p) + sellerSuccessFee(p) - companyTake(p) + pkr(1_500), pkr(4_500));
  });

  test('Rs 15,000 item: the FLOOR is what saves it', () => {
    const p = pkr(15_000);
    assert.deepEqual(pricingBreakdown(p), {
      salePrice: p,
      buyerFee: pkr(1_500), // 5% = 750, floored
      sellerFee: pkr(1_000), // 3% = 450, floored
      totalFees: pkr(2_500),
      dealerBonus: pkr(1_000), // 2% = 300, floored
      companyTake: pkr(1_500), // 10% of a 15,000 sale
    });
  });

  test('Rs 500,000 item: the CAP is what saves it', () => {
    const p = pkr(500_000);
    assert.deepEqual(pricingBreakdown(p), {
      salePrice: p,
      buyerFee: pkr(15_000), // 5% = 25,000, capped
      sellerFee: pkr(8_000), // 3% = 15,000, capped
      totalFees: pkr(23_000),
      dealerBonus: pkr(5_000), // 2% = 10,000, capped
      companyTake: pkr(18_000),
    });
    // Without the cap the dealer would have been paid Rs 10,000 for the same ~2.5 hours.
    assert.ok(dealerSuccessBonus(p) < pkr(10_000));
  });

  test('Rs 40,000 laptop', () => {
    const p = pkr(40_000);
    assert.equal(buyerSuccessFee(p), pkr(2_000));
    assert.equal(sellerSuccessFee(p), pkr(1_200));
    assert.equal(dealerSuccessBonus(p), pkr(1_000), '2% = 800, floored to 1,000');
    assert.equal(companyTake(p), pkr(2_200));
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

  test('floors and caps are always respected', () => {
    for (const p of prices) {
      if (p === 0) continue;
      assert.ok(buyerSuccessFee(p) >= CONFIRMED_PRICING.floors.buyer);
      assert.ok(buyerSuccessFee(p) <= CONFIRMED_PRICING.caps.buyer);
      assert.ok(sellerSuccessFee(p) >= CONFIRMED_PRICING.floors.seller);
      assert.ok(sellerSuccessFee(p) <= CONFIRMED_PRICING.caps.seller);
      assert.ok(dealerSuccessBonus(p) >= CONFIRMED_PRICING.floors.dealer);
      assert.ok(dealerSuccessBonus(p) <= CONFIRMED_PRICING.caps.dealer);
    }
  });

  test('the dealer bonus is always strictly less than the total fees collected', () => {
    for (const p of prices) {
      if (p === 0) continue;
      assert.ok(
        dealerSuccessBonus(p) < buyerSuccessFee(p) + sellerSuccessFee(p),
        `dealer bonus would bankrupt the platform at ${p}`,
      );
    }
  });

  test('buyerTotalOverSticker = buyer fee + bid (seller fee is not the buyer cost)', () => {
    assert.equal(buyerTotalOverSticker(pkr(150_000), pkr(1_500)), pkr(9_000));
    // 159,000 total spend on a 150,000 item = 6% over sticker.
    assert.equal(toRupees(buyerTotalOverSticker(pkr(150_000), pkr(1_500))), 9_000);
  });

  test('the company nets a positive contribution across the whole v1 range', () => {
    // Rough per-transaction cost model from docs/06 section 2.1.
    const ops = pkr(120);
    for (const p of prices) {
      if (p === 0) continue;
      const b = pricingBreakdown(p);
      const psp = Math.round(b.totalFees * 0.035);
      const reserve = Math.round(p * 0.012);
      const contribution = b.companyTake - psp - ops - reserve;
      assert.ok(contribution > 0, `platform loses money at Rs ${toRupees(p)}`);
    }
  });
});

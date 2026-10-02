import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  pkr,
  toRupees,
  formatPkr,
  assertMoney,
  add,
  sub,
  bpsOf,
  clamp,
  divRoundHalfUp,
  MoneyError,
} from '../src/money.ts';

describe('money', () => {
  test('pkr converts whole rupees to paisa', () => {
    assert.equal(pkr(1), 100);
    assert.equal(pkr(1500), 150_000);
    assert.equal(pkr(150_000), 15_000_000);
    assert.equal(pkr(0), 0);
  });

  test('toRupees is the inverse of pkr', () => {
    for (const r of [0, 1, 999, 1_500, 150_000, 500_000]) {
      assert.equal(toRupees(pkr(r)), r);
    }
  });

  test('formatPkr renders as Pakistani rupees', () => {
    assert.equal(formatPkr(pkr(4_500)), 'Rs 4,500');
    assert.equal(formatPkr(pkr(150_000)), 'Rs 150,000');
    assert.equal(formatPkr(150), 'Rs 1.50');
  });

  test('assertMoney rejects non-integers, negatives, non-finite', () => {
    assert.equal(assertMoney(0), 0);
    assert.equal(assertMoney(150_000), 150_000);
    assert.throws(() => assertMoney(1.5), MoneyError);
    assert.throws(() => assertMoney(-1), MoneyError);
    assert.throws(() => assertMoney(Number.NaN), MoneyError);
    assert.throws(() => assertMoney(Number.POSITIVE_INFINITY), MoneyError);
    assert.throws(() => assertMoney(Number.MAX_SAFE_INTEGER + 1), MoneyError);
  });

  test('add and sub are exact', () => {
    assert.equal(add(1, 2, 3), 6);
    assert.equal(add(pkr(150_000), pkr(7_500)), pkr(157_500));
    assert.equal(sub(pkr(12_000), pkr(3_000)), pkr(9_000));
    assert.throws(() => sub(1, 2), MoneyError, 'sub must not silently go negative');
  });

  test('divRoundHalfUp rounds .5 away from zero', () => {
    assert.equal(divRoundHalfUp(1, 2), 1); // 0.5 -> 1
    assert.equal(divRoundHalfUp(1, 4), 0); // 0.25 -> 0
    assert.equal(divRoundHalfUp(3, 4), 1); // 0.75 -> 1
    assert.equal(divRoundHalfUp(2, 3), 1); // 0.667 -> 1
    assert.equal(divRoundHalfUp(1, 3), 0); // 0.333 -> 0
    assert.equal(divRoundHalfUp(0, 5), 0);
    assert.throws(() => divRoundHalfUp(1, 0), MoneyError);
  });

  test('bpsOf computes exact basis points with half-up', () => {
    assert.equal(bpsOf(pkr(150_000), 500), pkr(7_500)); // 5%
    assert.equal(bpsOf(pkr(150_000), 300), pkr(4_500)); // 3%
    assert.equal(bpsOf(pkr(150_000), 200), pkr(3_000)); // 2%
    assert.equal(bpsOf(0, 500), 0);
    assert.equal(bpsOf(1, 5_000), 1, '0.5 paisa rounds up to 1');
  });

  test('clamp respects floor and cap and rejects an inverted band', () => {
    assert.equal(clamp(50, 100, 200), 100);
    assert.equal(clamp(150, 100, 200), 150);
    assert.equal(clamp(250, 100, 200), 200);
    assert.throws(() => clamp(5, 200, 100), MoneyError);
  });
});

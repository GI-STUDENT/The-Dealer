import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { pkr } from '../src/money.ts';
import {
  suggestedBand,
  checkBid,
  categoryBase,
  CATEGORY_BASE_PKR,
  BID_PER_KM_PKR,
  MAX_DISTANCE_KM,
} from '../src/bid.ts';

describe('bid — suggested band (km based)', () => {
  test('the full 50 km range is a Rs 1,500 normal bid', () => {
    const band = suggestedBand({ distanceKm: 50 });
    assert.equal(BID_PER_KM_PKR, 30);
    assert.equal(band.mid, pkr(1_500));
    assert.equal(band.min, Math.round(pkr(1_500) * 0.85));
    assert.equal(band.max, Math.round(pkr(1_500) * 1.2));
    assert.ok(band.min <= band.mid && band.mid <= band.max);
  });

  test('a 10 km job is a Rs 300 normal bid', () => {
    const band = suggestedBand({ distanceKm: 10 });
    assert.equal(band.mid, pkr(300));
    assert.equal(band.min, Math.round(pkr(300) * 0.85));
    assert.equal(band.max, Math.round(pkr(300) * 1.2));
  });

  test('the normal bid scales linearly with the distance', () => {
    assert.equal(suggestedBand({ distanceKm: 5 }).mid, pkr(150));
    assert.equal(suggestedBand({ distanceKm: 25 }).mid, pkr(750));
    assert.equal(suggestedBand({ distanceKm: 50 }).mid, pkr(1_500));
  });

  test('distance uses whole-kilometre ceiling, so 3.1 km costs the same as 4 km', () => {
    const a = suggestedBand({ distanceKm: 3.1 });
    const b = suggestedBand({ distanceKm: 4.0 });
    assert.equal(a.mid, b.mid);
    assert.equal(a.mid, pkr(120));
  });

  test('distance is capped at the 50 km maximum range', () => {
    assert.equal(MAX_DISTANCE_KM, 50);
    assert.equal(suggestedBand({ distanceKm: 80 }).mid, pkr(1_500));
  });

  test('difficulty and serial flags raise the band', () => {
    const plain = suggestedBand({ distanceKm: 10 });
    const hard = suggestedBand({
      distanceKm: 10,
      difficultyMultipliers: [1.25],
      hasSerial: true,
    });
    assert.ok(hard.mid > plain.mid);
  });

  test('a 0 km job still gets a 1 km floor instead of an empty band', () => {
    assert.equal(suggestedBand({ distanceKm: 0 }).mid, pkr(30));
  });

  test('every category has a positive base', () => {
    for (const key of Object.keys(CATEGORY_BASE_PKR)) {
      assert.ok(categoryBase(key as keyof typeof CATEGORY_BASE_PKR) > 0);
    }
  });

  test('rejects a negative distance and a bad multiplier', () => {
    assert.throws(() => suggestedBand({ distanceKm: -1 }));
    assert.throws(() => suggestedBand({ distanceKm: 1, difficultyMultipliers: [0] }));
  });
});

describe('bid — checking a buyer bid against the band', () => {
  const band = { min: pkr(1_400), mid: pkr(1_650), max: pkr(1_980) };

  test('a bid inside the band is neither flagged', () => {
    const r = checkBid(pkr(1_650), band);
    assert.equal(r.belowBand, false);
    assert.equal(r.aboveBand, false);
  });

  test('a below-band bid is ALLOWED but flagged (never blocked)', () => {
    const r = checkBid(pkr(800), band);
    assert.equal(r.belowBand, true);
    assert.equal(r.aboveBand, false);
  });

  test('an above-band bid is flagged as overpaying', () => {
    const r = checkBid(pkr(5_000), band);
    assert.equal(r.belowBand, false);
    assert.equal(r.aboveBand, true);
  });

  test('boundaries are inclusive of the band', () => {
    assert.equal(checkBid(band.min, band).belowBand, false);
    assert.equal(checkBid(band.max, band).aboveBand, false);
  });

  test('a zero or negative bid is rejected outright', () => {
    assert.throws(() => checkBid(0, band));
    assert.throws(() => checkBid(-1, band));
  });
});

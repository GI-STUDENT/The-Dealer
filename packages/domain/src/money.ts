/**
 * Money is ALWAYS an integer count of paisa (1 PKR = 100 paisa), never a float.
 *
 * Every rupee amount in the docs (Rs 1,500; Rs 150,000) is a presentation value. Arithmetic
 * happens only here, only on integers, and the result is validated before it is allowed to
 * become a `Money`. See `docs/06-payments-commission.md` section 3.1.
 */

export type Money = number;

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoneyError';
  }
}

/** Assert a value is a valid non-negative integer amount of paisa. */
export function assertMoney(value: number, label = 'amount'): Money {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new MoneyError(`${label} must be a finite number, got ${String(value)}`);
  }
  if (!Number.isSafeInteger(value)) {
    throw new MoneyError(`${label} must be a safe integer, got ${value}`);
  }
  if (value < 0) {
    throw new MoneyError(`${label} must not be negative, got ${value}`);
  }
  return value;
}

/** Exact integer addition. Guards against overflow past Number.MAX_SAFE_INTEGER. */
export function add(...amounts: Money[]): Money {
  let total = 0;
  for (const a of amounts) total += assertMoney(a);
  return assertMoney(total, 'sum');
}

export function sub(a: Money, b: Money): Money {
  return assertMoney(assertMoney(a) - assertMoney(b), 'difference');
}

/** Convert whole rupees to paisa. `pkr(1500) === 150000`. */
export function pkr(rupees: number): Money {
  if (!Number.isFinite(rupees)) throw new MoneyError(`rupees must be finite, got ${rupees}`);
  return assertMoney(Math.round(rupees * 100), 'rupees->paisa');
}

/** Convert paisa to a rupee display number. For presentation only, never for arithmetic. */
export function toRupees(amount: Money): number {
  return assertMoney(amount) / 100;
}

/** Format for UI and copy: "Rs 4,500" or "Rs 4,500.50". */
export function formatPkr(amount: Money): string {
  const rupees = toRupees(amount);
  const hasPaisa = !Number.isInteger(rupees);
  return `Rs ${rupees.toLocaleString('en-PK', {
    minimumFractionDigits: hasPaisa ? 2 : 0,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * Half-up division of `numerator / denominator`, operating on integers so no float ever
 * touches a balance. Used for percentages. Rounds .5 away from zero.
 */
export function divRoundHalfUp(numerator: number, denominator: number): number {
  if (denominator <= 0) throw new MoneyError('denominator must be positive');
  if (!Number.isSafeInteger(numerator) || numerator < 0) {
    throw new MoneyError(`numerator must be a non-negative safe integer, got ${numerator}`);
  }
  return Math.floor((numerator * 2 + denominator) / (2 * denominator));
}

/** `bps` basis points of `amount`. 500 bps = 5%. Half-up at the paisa. */
export function bpsOf(amount: Money, bps: number): Money {
  assertMoney(amount);
  if (!Number.isInteger(bps) || bps < 0) {
    throw new MoneyError(`bps must be a non-negative integer, got ${bps}`);
  }
  return assertMoney(divRoundHalfUp(amount * bps, 10_000), 'bpsOf');
}

export function clamp(amount: Money, floor: Money, cap: Money): Money {
  assertMoney(amount, 'amount');
  assertMoney(floor, 'floor');
  assertMoney(cap, 'cap');
  if (floor > cap) throw new MoneyError(`floor ${floor} exceeds cap ${cap}`);
  return Math.min(Math.max(amount, floor), cap);
}

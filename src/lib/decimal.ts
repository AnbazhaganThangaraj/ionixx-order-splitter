import DecimalJs from 'decimal.js';

/**
 * Project-wide Decimal constructor for ALL money, percentage, price and share
 * quantity arithmetic. Native JS numbers are binary floats (0.1 + 0.2 !== 0.3),
 * which is unacceptable for financial calculations.
 *
 * Rounding is always chosen explicitly at the call site (toDecimalPlaces with a
 * rounding mode); the default below only applies to intermediate division.
 */
export const Decimal = DecimalJs.clone({
  precision: 40,
  rounding: DecimalJs.ROUND_HALF_UP,
  toExpNeg: -40,
  toExpPos: 40,
});

export type Decimal = InstanceType<typeof Decimal>;

export const ROUND_DOWN = DecimalJs.ROUND_DOWN;
export const ROUND_HALF_UP = DecimalJs.ROUND_HALF_UP;

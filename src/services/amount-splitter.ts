import { Decimal, ROUND_DOWN } from '../lib/decimal';

/**
 * Splits totalAmount across allocation percentages, in whole cents.
 *
 * Every line except the last is rounded DOWN to cents; the last line receives
 * whatever remains. This guarantees the lines add up to EXACTLY totalAmount,
 * so no cent is created or lost. Example: 100.00 at 33.3333/33.3333/33.3334
 * gives 33.33 + 33.33 + 33.34.
 *
 * Precondition (enforced by validation): allocations are positive and sum to 100.
 */
export const splitAmount = (
  totalAmount: Decimal,
  allocationPercents: readonly Decimal[],
  moneyPrecision: number,
): Decimal[] => {
  if (allocationPercents.length === 0) return [];

  const amounts = allocationPercents.map((percent) =>
    totalAmount.times(percent).dividedBy(100).toDecimalPlaces(moneyPrecision, ROUND_DOWN),
  );

  const allButLast = amounts.slice(0, -1).reduce((sum, amount) => sum.plus(amount), new Decimal(0));
  amounts[amounts.length - 1] = totalAmount.minus(allButLast);

  return amounts;
};

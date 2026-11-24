import { Decimal, ROUND_DOWN } from '../lib/decimal';

/**
 * Splits totalAmount across allocation percentages, in whole cents, using the
 * largest-remainder (Hamilton) method:
 *
 * 1. Every line gets its exact share rounded DOWN to cents.
 * 2. The cents left over (always fewer than the number of lines) are handed out one at a
 *    time to the lines whose exact share lost the most to rounding; ties go to the
 *    earlier line, so the result is deterministic.
 *
 * Guarantees: the lines add up to EXACTLY totalAmount, and every line is within one
 * cent of its exact share. (Giving all leftover cents to one line could push it far off
 * its weight, e.g. $199.99 over 100 x 1% would give the last stock $2.98 instead of ~$2.00.)
 *
 * Precondition (enforced by validation): allocations are positive and sum to 100.
 */
export const splitAmount = (
  totalAmount: Decimal,
  allocationPercents: readonly Decimal[],
  moneyPrecision: number,
): Decimal[] => {
  const cent = new Decimal(1).dividedBy(new Decimal(10).pow(moneyPrecision));

  const lines = allocationPercents.map((percent, index) => {
    const exact = totalAmount.times(percent).dividedBy(100);
    const rounded = exact.toDecimalPlaces(moneyPrecision, ROUND_DOWN);
    return { index, amount: rounded, remainder: exact.minus(rounded) };
  });

  const allocated = lines.reduce((sum, line) => sum.plus(line.amount), new Decimal(0));
  const leftoverCents = totalAmount.minus(allocated).dividedBy(cent).round().toNumber();

  [...lines]
    .sort((a, b) => b.remainder.comparedTo(a.remainder) || a.index - b.index)
    .slice(0, leftoverCents)
    .forEach((line) => {
      line.amount = line.amount.plus(cent);
    });

  return lines.map((line) => line.amount);
};

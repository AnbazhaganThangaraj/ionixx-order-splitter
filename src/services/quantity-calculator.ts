import { type Decimal, ROUND_DOWN, ROUND_HALF_UP } from '../lib/decimal';

export interface QuantityResult {
  /** Shares, rounded DOWN to quantityPrecision so the order never exceeds its amount. */
  readonly quantity: Decimal;
  /** quantity x price, rounded to cents. */
  readonly estimatedValue: Decimal;
  /** amount - estimatedValue: cash left over because the quantity was rounded down. */
  readonly residualAmount: Decimal;
}

export const calculateQuantity = (
  amount: Decimal,
  price: Decimal,
  quantityPrecision: number,
  moneyPrecision: number,
): QuantityResult => {
  const quantity = amount.dividedBy(price).toDecimalPlaces(quantityPrecision, ROUND_DOWN);

  // quantity x price <= amount (quantity was rounded down) and amount is a whole
  // number of cents, so rounding the value to cents can never exceed amount.
  const estimatedValue = quantity.times(price).toDecimalPlaces(moneyPrecision, ROUND_HALF_UP);

  return {
    quantity,
    estimatedValue,
    residualAmount: amount.minus(estimatedValue),
  };
};

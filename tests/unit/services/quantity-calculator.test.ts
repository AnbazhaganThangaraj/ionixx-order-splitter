import { Decimal } from '../../../src/lib/decimal';
import { calculateQuantity } from '../../../src/services/quantity-calculator';

const calc = (amount: string, price: string, precision: number) => {
  const r = calculateQuantity(new Decimal(amount), new Decimal(price), precision, 2);
  return {
    quantity: r.quantity.toFixed(precision),
    estimatedValue: r.estimatedValue.toFixed(2),
    residualAmount: r.residualAmount.toFixed(2),
  };
};

describe('calculateQuantity', () => {
  it('calculates fractional shares: $60 at $100 -> 0.600', () => {
    expect(calc('60', '100', 3)).toEqual({
      quantity: '0.600',
      estimatedValue: '60.00',
      residualAmount: '0.00',
    });
  });

  it('uses the given price: $60 at $150 -> 0.400', () => {
    expect(calc('60', '150', 3).quantity).toBe('0.400');
  });

  it('rounds DOWN, never up, so the order cannot exceed its amount', () => {
    // 100 / 3 = 33.3333...; 2 / 3 = 0.6666... (would round UP to 0.667)
    expect(calc('100', '3', 3).quantity).toBe('33.333');
    expect(calc('2', '3', 3).quantity).toBe('0.666');
  });

  it('respects a precision of 7 decimal places', () => {
    expect(calc('100', '3', 7)).toEqual({
      quantity: '33.3333333',
      estimatedValue: '100.00',
      residualAmount: '0.00',
    });
  });

  it('respects a precision of 0 (whole shares only)', () => {
    expect(calc('250', '100', 0)).toEqual({
      quantity: '2',
      estimatedValue: '200.00',
      residualAmount: '50.00',
    });
  });

  it('reports residual cash caused by rounding', () => {
    // 10 / 3 = 3.333 shares -> 3.333 x 3 = 9.999 -> 10.00 (rounded to cents), residual 0.00
    expect(calc('10', '3', 3)).toEqual({
      quantity: '3.333',
      estimatedValue: '10.00',
      residualAmount: '0.00',
    });
    // 10 / 7 = 1.428 shares -> 1.428 x 7 = 9.996 -> 10.00
    expect(calc('10', '7', 3).residualAmount).toBe('0.00');
    // 10 / 700 = 0.014 shares -> 0.014 x 700 = 9.80, residual 0.20
    expect(calc('10', '700', 3)).toEqual({
      quantity: '0.014',
      estimatedValue: '9.80',
      residualAmount: '0.20',
    });
  });

  it('returns zero shares when the amount is too small', () => {
    expect(calc('0.01', '100', 3)).toEqual({
      quantity: '0.000',
      estimatedValue: '0.00',
      residualAmount: '0.01',
    });
  });

  it('can trade a tiny amount once precision allows it', () => {
    expect(calc('0.01', '100', 7).quantity).toBe('0.0001000');
  });

  it.each([
    ['33.33', '187.43', 3],
    ['0.07', '0.0003', 2],
    ['999999.99', '1234.5678', 7],
    ['1', '1000000', 3],
  ])(
    'value never exceeds the amount and residual is never negative (%s @ %s)',
    (amount, price, precision) => {
      const r = calculateQuantity(new Decimal(amount), new Decimal(price), precision, 2);
      expect(r.estimatedValue.lte(amount)).toBe(true);
      expect(r.residualAmount.gte(0)).toBe(true);
      expect(r.estimatedValue.plus(r.residualAmount).eq(amount)).toBe(true);
    },
  );
});

import { Decimal } from '../../../src/lib/decimal';
import { splitAmount } from '../../../src/services/amount-splitter';

const split = (total: string, percents: string[]): string[] =>
  splitAmount(
    new Decimal(total),
    percents.map((p) => new Decimal(p)),
    2,
  ).map((d) => d.toFixed(2));

const sum = (values: string[]): string =>
  values.reduce((acc, v) => acc.plus(v), new Decimal(0)).toFixed(2);

describe('splitAmount', () => {
  it('splits the brief example: USD 100 at 60/40 -> 60.00 / 40.00', () => {
    expect(split('100', ['60', '40'])).toEqual(['60.00', '40.00']);
  });

  it('gives leftover cents to the last line so the total is exact', () => {
    expect(split('100', ['33.3333', '33.3333', '33.3334'])).toEqual(['33.33', '33.33', '33.34']);
  });

  it('handles amounts that do not divide into whole cents', () => {
    expect(split('0.10', ['33.3333', '33.3333', '33.3334'])).toEqual(['0.03', '0.03', '0.04']);
  });

  it('handles a single stock', () => {
    expect(split('123.45', ['100'])).toEqual(['123.45']);
  });

  it('returns an empty list for an empty portfolio', () => {
    expect(splitAmount(new Decimal(100), [], 2)).toEqual([]);
  });

  it.each([
    ['100', ['60', '40']],
    ['99.99', ['33.3333', '33.3333', '33.3334']],
    ['0.01', ['50', '50']],
    ['1000000000', ['12.5', '37.5', '25', '25']],
    ['7.77', ['0.0001', '99.9999']],
    ['250.55', ['10', '20', '30', '15.5', '24.5']],
  ])('lines always add up exactly to the total (%s)', (total, percents) => {
    const amounts = split(total, percents);
    expect(sum(amounts)).toBe(new Decimal(total).toFixed(2));
    amounts.forEach((amount) => {
      expect(new Decimal(amount).gte(0)).toBe(true);
    });
  });
});

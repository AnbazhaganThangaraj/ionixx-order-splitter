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

  it('gives leftover cents to the lines that lost the most to rounding', () => {
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

  it('spreads leftover cents instead of piling them onto one line', () => {
    // 199.99 over 100 x 1%: exact share 1.9999 each; 99 leftover cents.
    const amounts = split(
      '199.99',
      Array.from({ length: 100 }, () => '1'),
    );
    expect(amounts.slice(0, 99).every((a) => a === '2.00')).toBe(true);
    expect(amounts[99]).toBe('1.99');
    expect(sum(amounts)).toBe('199.99');
  });

  it('gives a cent to the largest remainder, not to the last line', () => {
    // exact shares: 0.6667, 0.3333 -> 0.66 + 0.33 = 0.99; the cent goes to the first line.
    expect(split('1.00', ['66.67', '33.33'])).toEqual(['0.67', '0.33']);
  });

  it('breaks ties by position, deterministically', () => {
    expect(split('0.01', ['50', '50'])).toEqual(['0.01', '0.00']);
    expect(split('0.02', ['33.3333', '33.3333', '33.3334'])).toEqual(['0.01', '0.00', '0.01']);
  });

  it.each([
    ['199.99', Array.from({ length: 100 }, () => '1')],
    ['1.99', Array.from({ length: 100 }, () => '1')],
    ['1000000000', ['12.5', '37.5', '25', '25']],
    ['0.07', ['14.2857', '14.2857', '14.2857', '14.2857', '14.2857', '14.2857', '14.2858']],
    ['12345.67', ['0.0001', '0.0002', '99.9997']],
    ['99.99', ['33.3333', '33.3333', '33.3334']],
  ])('every line is within one cent of its exact share (%s)', (total, percents) => {
    const amounts = split(total, percents);
    amounts.forEach((amount, i) => {
      const exact = new Decimal(total).times(percents[i] ?? '0').dividedBy(100);
      expect(new Decimal(amount).minus(exact).abs().lt('0.01')).toBe(true);
    });
    expect(sum(amounts)).toBe(new Decimal(total).toFixed(2));
  });
});

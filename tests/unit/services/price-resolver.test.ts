import { Decimal } from '../../../src/lib/decimal';
import { resolvePrice } from '../../../src/services/price-resolver';

describe('resolvePrice', () => {
  const defaultPrice = new Decimal(100);

  it('uses the partner price when supplied', () => {
    const result = resolvePrice(new Decimal('150.25'), defaultPrice);
    expect(result.price.toString()).toBe('150.25');
    expect(result.source).toBe('PARTNER');
  });

  it('falls back to the configured default when no price is supplied', () => {
    const result = resolvePrice(undefined, defaultPrice);
    expect(result.price.toString()).toBe('100');
    expect(result.source).toBe('DEFAULT');
  });

  it('prefers the partner price even when it equals the default', () => {
    expect(resolvePrice(new Decimal(100), defaultPrice).source).toBe('PARTNER');
  });
});

import type { PriceSource } from '../domain/order.enums';
import type { Decimal } from '../lib/decimal';

export interface ResolvedPrice {
  readonly price: Decimal;
  readonly source: PriceSource;
}

/**
 * Partner-supplied market price wins; otherwise the configured default price
 * applies. Invalid partner prices never reach this point: they are rejected by
 * validation rather than silently replaced with the default.
 */
export const resolvePrice = (
  partnerPrice: Decimal | undefined,
  defaultPrice: Decimal,
): ResolvedPrice =>
  partnerPrice === undefined
    ? { price: defaultPrice, source: 'DEFAULT' }
    : { price: partnerPrice, source: 'PARTNER' };

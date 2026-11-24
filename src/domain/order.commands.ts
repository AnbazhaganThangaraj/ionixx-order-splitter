import type { Decimal } from '../lib/decimal';
import type { Currency, OrderType } from './order.enums';

/**
 * Inputs to the order use cases, in domain terms (Decimal, not strings). The HTTP
 * validators produce these types; services depend only on them, never on Zod.
 */
export interface PortfolioItemInput {
  readonly symbol: string;
  readonly allocation: Decimal;
  readonly marketPrice?: Decimal | undefined;
}

export interface CreateOrderCommand {
  readonly orderType: OrderType;
  readonly totalAmount: Decimal;
  readonly currency: Currency;
  readonly portfolio: readonly PortfolioItemInput[];
}

export interface ListOrdersQuery {
  readonly limit: number;
  readonly offset: number;
  readonly orderType?: OrderType | undefined;
}

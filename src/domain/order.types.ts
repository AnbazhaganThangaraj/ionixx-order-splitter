import type { Currency, ExecutionReason, OrderStatus, OrderType, PriceSource } from './order.enums';

/**
 * Stored / returned order representation. All numeric values are decimal
 * STRINGS so no precision is lost in JSON (JSON numbers are IEEE-754 doubles).
 */
export interface OrderLine {
  readonly symbol: string;
  readonly allocationPercent: string;
  /** Share of totalAmount assigned to this stock, in cents. */
  readonly allocatedAmount: string;
  readonly price: string;
  readonly priceSource: PriceSource;
  /** Number of shares, rounded DOWN to the configured precision. */
  readonly quantity: string;
  /** quantity x price, rounded to cents. */
  readonly estimatedValue: string;
  /** allocatedAmount - estimatedValue: cash left over because quantity was rounded down. */
  readonly residualAmount: string;
}

export interface OrderExecution {
  /** ISO-8601 timestamp with the market's UTC offset. */
  readonly executeAt: string;
  readonly timeZone: string;
  readonly reason: ExecutionReason;
}

export interface OrderTotals {
  readonly allocatedAmount: string;
  readonly estimatedValue: string;
  readonly residualAmount: string;
}

export interface Order {
  readonly orderId: string;
  readonly orderType: OrderType;
  readonly status: OrderStatus;
  readonly currency: Currency;
  readonly totalAmount: string;
  readonly quantityPrecision: number;
  readonly lines: readonly OrderLine[];
  readonly totals: OrderTotals;
  readonly execution: OrderExecution;
  /** Human-readable notes about edge cases, e.g. an allocation too small to buy any shares. */
  readonly warnings: readonly string[];
  readonly createdAt: string;
}

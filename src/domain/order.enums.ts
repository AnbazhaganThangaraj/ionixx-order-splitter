export const ORDER_TYPES = ['BUY', 'SELL'] as const;
export type OrderType = (typeof ORDER_TYPES)[number];

/** POC supports USD only: the fixed default price ($100) is a USD price. */
export const SUPPORTED_CURRENCIES = ['USD'] as const;
export type Currency = (typeof SUPPORTED_CURRENCIES)[number];

/** Orders are calculated and scheduled; this service never executes trades itself. */
export const ORDER_STATUSES = ['SCHEDULED'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** Where the price used for a line came from. */
export const PRICE_SOURCES = ['PARTNER', 'DEFAULT'] as const;
export type PriceSource = (typeof PRICE_SOURCES)[number];

/** Why an order got the execution time it did. */
export const EXECUTION_REASONS = [
  'MARKET_OPEN', // market is open now: execute immediately
  'BEFORE_MARKET_OPEN', // weekday, before open: execute at today's open
  'AFTER_MARKET_CLOSE', // weekday, after close: execute at next weekday's open
  'WEEKEND', // Saturday/Sunday: execute at Monday's open
] as const;
export type ExecutionReason = (typeof EXECUTION_REASONS)[number];

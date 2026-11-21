import { z } from 'zod';
import { ORDER_TYPES, SUPPORTED_CURRENCIES } from '../domain/order.enums';
import { Decimal } from '../lib/decimal';
import { positiveDecimal } from './decimal.schema';

/** Upper bounds are sanity limits for the POC, not business rules. */
export const ORDER_LIMITS = {
  maxTotalAmount: '1000000000', // USD 1bn
  maxMarketPrice: '1000000',
  maxPortfolioSize: 100,
  maxPageSize: 100,
  defaultPageSize: 20,
} as const;

/** Exchange tickers: letters/digits plus "." or "-" for share classes (e.g. BRK.B). */
const SYMBOL_PATTERN = /^[A-Z][A-Z0-9.-]{0,11}$/;

const portfolioItemSchema = z.strictObject(
  {
    symbol: z
      .string({ error: 'is required and must be a string' })
      .trim()
      .toUpperCase()
      .regex(SYMBOL_PATTERN, 'must be a ticker such as "AAPL" or "BRK.B" (max 12 characters)'),
    allocation: positiveDecimal({ maxDecimals: 4, max: '100' }),
    marketPrice: positiveDecimal({ maxDecimals: 4, max: ORDER_LIMITS.maxMarketPrice }).optional(),
  },
  // Strict on purpose: a typo such as "markePrice" must fail loudly instead of
  // silently falling back to the default price.
  { error: (issue) => (issue.code === 'unrecognized_keys' ? undefined : 'must be an object') },
);

export const createOrderSchema = z
  .strictObject(
    {
      orderType: z.enum(ORDER_TYPES, { error: `must be one of: ${ORDER_TYPES.join(', ')}` }),
      totalAmount: positiveDecimal({ maxDecimals: 2, max: ORDER_LIMITS.maxTotalAmount }),
      currency: z
        .enum(SUPPORTED_CURRENCIES, {
          error: `must be one of: ${SUPPORTED_CURRENCIES.join(', ')}`,
        })
        .default('USD'),
      portfolio: z
        .array(portfolioItemSchema, { error: 'must be an array of stocks' })
        .min(1, 'must contain at least one stock')
        .max(
          ORDER_LIMITS.maxPortfolioSize,
          `must contain at most ${ORDER_LIMITS.maxPortfolioSize} stocks`,
        ),
    },
    {
      error: (issue) => (issue.code === 'unrecognized_keys' ? undefined : 'must be a JSON object'),
    },
  )
  .superRefine((order, ctx) => {
    const seen = new Map<string, number>();
    order.portfolio.forEach((item, index) => {
      const firstIndex = seen.get(item.symbol);
      if (firstIndex !== undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['portfolio', index, 'symbol'],
          message: `duplicate symbol "${item.symbol}" (already at portfolio[${firstIndex}])`,
        });
      } else {
        seen.set(item.symbol, index);
      }
    });

    const totalAllocation = order.portfolio.reduce(
      (sum, item) => sum.plus(item.allocation),
      new Decimal(0),
    );
    if (!totalAllocation.eq(100)) {
      ctx.addIssue({
        code: 'custom',
        path: ['portfolio'],
        message: `allocations must add up to exactly 100 (got ${totalAllocation.toString()})`,
      });
    }
  });

export type CreateOrderCommand = z.output<typeof createOrderSchema>;

export const listOrdersQuerySchema = z.strictObject({
  limit: z.coerce
    .number({ error: 'must be an integer' })
    .int('must be an integer')
    .min(1, 'must be at least 1')
    .max(ORDER_LIMITS.maxPageSize, `must be at most ${ORDER_LIMITS.maxPageSize}`)
    .default(ORDER_LIMITS.defaultPageSize),
  offset: z.coerce
    .number({ error: 'must be an integer' })
    .int('must be an integer')
    .min(0, 'must be 0 or more')
    .default(0),
  orderType: z.enum(ORDER_TYPES, { error: `must be one of: ${ORDER_TYPES.join(', ')}` }).optional(),
});

export type ListOrdersQuery = z.output<typeof listOrdersQuerySchema>;

export const orderIdParamSchema = z.object({
  orderId: z.uuid({ error: 'must be a valid UUID' }),
});

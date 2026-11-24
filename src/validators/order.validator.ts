import { z } from 'zod';
import { ORDER_TYPES, SUPPORTED_CURRENCIES } from '../domain/order.enums';
import { quote } from '../errors/app-error';
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

const PORTFOLIO_ITEM_FIELDS = ['symbol', 'allocation', 'marketPrice'];
const ORDER_FIELDS = ['orderType', 'totalAmount', 'currency', 'portfolio'];
const QUERY_FIELDS = ['limit', 'offset', 'orderType'];

/** Describes a received value for an error message without echoing large inputs. */
const describe = (input: unknown): string => {
  if (input === null) return 'null';
  if (Array.isArray(input)) return 'an array';
  if (typeof input === 'string') return quote(input, 20);
  return typeof input === 'object' ? 'an object' : typeof input;
};

interface IssueLike {
  readonly code?: string;
  readonly input?: unknown;
  readonly keys?: readonly string[];
}

/** "is required (...)" when the field is absent, otherwise "must be ... (got ...)". */
const requiredOr =
  (requirement: string) =>
  (issue: IssueLike): string =>
    issue.input === undefined
      ? `is required (${requirement})`
      : `must be ${requirement} (got ${describe(issue.input)})`;

/** Message for a strict object: lists unknown AND allowed fields, or says what was expected. */
const strictObjectError =
  (allowed: readonly string[], expected: string) =>
  (issue: IssueLike): string =>
    issue.code === 'unrecognized_keys'
      ? `unknown field(s): ${(issue.keys ?? []).join(', ')}; allowed fields: ${allowed.join(', ')}`
      : requiredOr(expected)(issue);

const portfolioItemSchema = z.strictObject(
  {
    symbol: z
      .string({ error: requiredOr('a ticker string such as "AAPL"') })
      .trim()
      .toUpperCase()
      .regex(SYMBOL_PATTERN, 'must be a ticker such as "AAPL" or "BRK.B" (max 12 characters)'),
    allocation: positiveDecimal({ maxDecimals: 4, max: '100' }),
    marketPrice: positiveDecimal({ maxDecimals: 4, max: ORDER_LIMITS.maxMarketPrice }).optional(),
  },
  // Strict on purpose: a typo such as "markePrice" must fail loudly instead of
  // silently falling back to the default price.
  { error: strictObjectError(PORTFOLIO_ITEM_FIELDS, 'an object with symbol and allocation') },
);

export const createOrderSchema = z
  .strictObject(
    {
      orderType: z.enum(ORDER_TYPES, { error: requiredOr(`one of ${ORDER_TYPES.join(', ')}`) }),
      totalAmount: positiveDecimal({ maxDecimals: 2, max: ORDER_LIMITS.maxTotalAmount }),
      currency: z
        .enum(SUPPORTED_CURRENCIES, {
          error: requiredOr(`${SUPPORTED_CURRENCIES.join(', ')} (the only supported currency)`),
        })
        .default('USD'),
      portfolio: z
        .array(portfolioItemSchema, {
          error: requiredOr('an array of { symbol, allocation, marketPrice? } objects'),
        })
        .min(1, 'must contain at least one stock')
        .max(
          ORDER_LIMITS.maxPortfolioSize,
          `must contain at most ${ORDER_LIMITS.maxPortfolioSize} stocks`,
        ),
    },
    {
      error: strictObjectError(
        ORDER_FIELDS,
        'a JSON object with orderType, totalAmount and portfolio',
      ),
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
          message: `duplicate symbol "${item.symbol}" (already at portfolio[${firstIndex}]); combine them into one entry`,
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
      const gap = totalAllocation.lt(100)
        ? `${new Decimal(100).minus(totalAllocation).toString()} short`
        : `${totalAllocation.minus(100).toString()} over`;
      ctx.addIssue({
        code: 'custom',
        path: ['portfolio'],
        message: `allocations must add up to exactly 100 (got ${totalAllocation.toString()}, ${gap})`,
      });
    }
  });

export type CreateOrderCommand = z.output<typeof createOrderSchema>;

const pageSizeMessage = `must be an integer from 1 to ${ORDER_LIMITS.maxPageSize}`;
const offsetMessage = 'must be an integer of 0 or more';

export const listOrdersQuerySchema = z.strictObject(
  {
    limit: z.coerce
      .number({ error: pageSizeMessage })
      .int(pageSizeMessage)
      .min(1, pageSizeMessage)
      .max(ORDER_LIMITS.maxPageSize, pageSizeMessage)
      .default(ORDER_LIMITS.defaultPageSize),
    offset: z.coerce
      .number({ error: offsetMessage })
      .int(offsetMessage)
      .min(0, offsetMessage)
      .default(0),
    orderType: z
      .enum(ORDER_TYPES, { error: requiredOr(`one of ${ORDER_TYPES.join(', ')}`) })
      .optional(),
  },
  { error: strictObjectError(QUERY_FIELDS, 'query parameters') },
);

export type ListOrdersQuery = z.output<typeof listOrdersQuerySchema>;

export const orderIdParamSchema = z.object({
  orderId: z.uuid({
    error: 'must be a valid order id (UUID), as returned when the order was created',
  }),
});

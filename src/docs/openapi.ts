import type { AppConfig } from '../config/app.config';
import { ERROR_CODES } from '../errors/error-codes';

const decimalString = (description: string, example: string): Record<string, unknown> => ({
  oneOf: [{ type: 'string', pattern: '^\\d+(\\.\\d+)?$' }, { type: 'number' }],
  description: `${description} Send as a decimal string (preferred) or a JSON number.`,
  example,
});

const errorResponse = (description: string, code: string): Record<string, unknown> => ({
  description,
  content: {
    'application/json': {
      schema: { $ref: '#/components/schemas/Error' },
      example: {
        error: { code, message: '...', details: [] },
        requestId: '6f1c8d2e-0b7a-4f3e-9c41-2d5e8a7b9c10',
      },
    },
  },
});

const secured = [{ ApiKeyAuth: [] }];
/** Response number formats: plain decimal strings; money always has exactly 2 decimals. */
const DECIMAL = '^\\d+(\\.\\d+)?$';
const MONEY = '^\\d+\\.\\d{2}$';

/** OpenAPI 3.1 contract, served at /docs (UI) and /docs/openapi.json (raw). */
export const buildOpenApiDocument = (config: AppConfig): Record<string, unknown> => ({
  openapi: '3.1.0',
  info: {
    title: 'Ionixx Order Splitter API',
    version: '1.0.0',
    description:
      'Splits a total BUY/SELL amount across a model portfolio, returns the amount and ' +
      'fractional share quantity per stock, when the order should execute, and order history. ' +
      `Current settings: default price USD ${config.order.defaultStockPrice}, ` +
      `quantity precision ${config.order.quantityPrecision} decimal places, market ` +
      `${config.market.timeZone} ${config.market.openTime}-${config.market.closeTime} Mon-Fri ` +
      '(no holiday calendar). Data is held in memory and lost on restart. ' +
      (config.auth.apiKeys.length > 0
        ? 'Authentication: send your partner API key in the X-API-Key header.'
        : 'Authentication is DISABLED on this instance (development mode).'),
  },
  servers: [{ url: `http://localhost:${config.port}` }],
  tags: [{ name: 'Orders' }, { name: 'Health' }],
  paths: {
    '/api/v1/orders': {
      post: {
        tags: ['Orders'],
        summary: 'Calculate and create a split order',
        security: secured,
        parameters: [
          {
            name: 'Idempotency-Key',
            in: 'header',
            required: false,
            description:
              'Optional. Retrying with the same key and body replays the original response ' +
              'instead of creating a second order. Scoped per partner, kept for ' +
              `${config.idempotency.ttlSeconds} seconds.`,
            schema: { type: 'string', pattern: '^[A-Za-z0-9._:-]{1,255}$' },
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/CreateOrderRequest' },
              examples: {
                briefExample: {
                  summary: 'USD 100 into AAPL 60% / TSLA 40% at the default price',
                  value: {
                    orderType: 'BUY',
                    totalAmount: '100',
                    currency: 'USD',
                    portfolio: [
                      { symbol: 'AAPL', allocation: '60' },
                      { symbol: 'TSLA', allocation: '40' },
                    ],
                  },
                },
                partnerPrices: {
                  summary: 'Partner-supplied market price for AAPL',
                  value: {
                    orderType: 'SELL',
                    totalAmount: '250.00',
                    portfolio: [
                      { symbol: 'AAPL', allocation: '60', marketPrice: '187.43' },
                      { symbol: 'TSLA', allocation: '40' },
                    ],
                  },
                },
              },
            },
          },
        },
        responses: {
          '201': {
            description: 'Order created',
            headers: {
              Location: { schema: { type: 'string' }, description: 'URL of the new order' },
              'X-Request-Id': { schema: { type: 'string' } },
              'Idempotent-Replayed': {
                schema: { type: 'string', enum: ['true'] },
                description: 'Present when this is a replay of an earlier response',
              },
            },
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Order' } } },
          },
          '400': errorResponse('Invalid JSON or failed validation', 'VALIDATION_ERROR'),
          '401': errorResponse('Missing or invalid API key', 'UNAUTHORIZED'),
          '409': errorResponse(
            'A request with this Idempotency-Key is still being processed',
            'IDEMPOTENCY_REQUEST_IN_PROGRESS',
          ),
          '413': errorResponse('Body larger than 100kb', 'PAYLOAD_TOO_LARGE'),
          '415': errorResponse('Content-Type is not application/json', 'UNSUPPORTED_MEDIA_TYPE'),
          '422': errorResponse(
            'The order would not trade anything (ORDER_NOT_EXECUTABLE: every line rounds ' +
              'down to zero shares), or the Idempotency-Key was reused with a different body ' +
              '(IDEMPOTENCY_KEY_REUSED)',
            'ORDER_NOT_EXECUTABLE',
          ),
          '429': errorResponse('Rate limit exceeded; see Retry-After', 'RATE_LIMITED'),
          '500': errorResponse('Unexpected error (details are never exposed)', 'INTERNAL_ERROR'),
        },
      },
      get: {
        tags: ['Orders'],
        summary: "List the partner's historic orders (newest first)",
        security: secured,
        parameters: [
          {
            name: 'limit',
            in: 'query',
            schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
          },
          { name: 'offset', in: 'query', schema: { type: 'integer', minimum: 0, default: 0 } },
          { name: 'orderType', in: 'query', schema: { type: 'string', enum: ['BUY', 'SELL'] } },
        ],
        responses: {
          '200': {
            description: 'A page of orders',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/OrderPage' } } },
          },
          '400': errorResponse('Invalid query parameters', 'VALIDATION_ERROR'),
          '401': errorResponse('Missing or invalid API key', 'UNAUTHORIZED'),
          '429': errorResponse('Rate limit exceeded; see Retry-After', 'RATE_LIMITED'),
          '500': errorResponse('Unexpected error (details are never exposed)', 'INTERNAL_ERROR'),
        },
      },
    },
    '/api/v1/orders/{orderId}': {
      get: {
        tags: ['Orders'],
        summary: 'Get one of your orders',
        security: secured,
        parameters: [
          {
            name: 'orderId',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        responses: {
          '200': {
            description: 'The order',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Order' } } },
          },
          '400': errorResponse('orderId is not a UUID', 'VALIDATION_ERROR'),
          '401': errorResponse('Missing or invalid API key', 'UNAUTHORIZED'),
          '404': errorResponse('No order with this id for your partner account', 'NOT_FOUND'),
          '429': errorResponse('Rate limit exceeded; see Retry-After', 'RATE_LIMITED'),
          '500': errorResponse('Unexpected error (details are never exposed)', 'INTERNAL_ERROR'),
        },
      },
    },
    '/health/live': {
      get: {
        tags: ['Health'],
        summary: 'Liveness probe (also available as /health)',
        responses: {
          '200': {
            description: 'Process is up',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/HealthLive' } },
            },
          },
        },
      },
    },
    '/health/ready': {
      get: {
        tags: ['Health'],
        summary: 'Readiness probe',
        responses: {
          '200': {
            description: 'Ready to receive traffic',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/HealthReady' } },
            },
          },
          '503': {
            description: 'Shutting down; stop sending traffic',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/HealthReady' } },
            },
          },
        },
      },
    },
  },
  components: {
    securitySchemes: {
      ApiKeyAuth: { type: 'apiKey', in: 'header', name: 'X-API-Key' },
    },
    schemas: {
      CreateOrderRequest: {
        type: 'object',
        additionalProperties: false,
        required: ['orderType', 'totalAmount', 'portfolio'],
        properties: {
          orderType: { type: 'string', enum: ['BUY', 'SELL'] },
          totalAmount: decimalString('Amount to buy or sell, > 0, max 2 decimal places.', '100.00'),
          currency: { type: 'string', enum: ['USD'], default: 'USD' },
          portfolio: {
            type: 'array',
            minItems: 1,
            maxItems: 100,
            description: 'Allocations must add up to exactly 100. Symbols must be unique.',
            items: { $ref: '#/components/schemas/PortfolioItem' },
          },
        },
      },
      PortfolioItem: {
        type: 'object',
        additionalProperties: false,
        required: ['symbol', 'allocation'],
        properties: {
          symbol: {
            type: 'string',
            example: 'AAPL',
            description: 'Ticker; normalised to upper case.',
          },
          allocation: decimalString(
            'Percentage of the order, > 0 and <= 100, max 4 decimal places.',
            '60',
          ),
          marketPrice: decimalString(
            `Optional partner price, > 0. Overrides the default USD ${config.order.defaultStockPrice}.`,
            '187.43',
          ),
        },
      },
      OrderLine: {
        type: 'object',
        additionalProperties: false,
        required: [
          'symbol',
          'allocationPercent',
          'allocatedAmount',
          'price',
          'priceSource',
          'quantity',
          'estimatedValue',
          'residualAmount',
        ],
        properties: {
          symbol: { type: 'string', example: 'AAPL' },
          allocationPercent: { type: 'string', pattern: DECIMAL, example: '60' },
          allocatedAmount: { type: 'string', pattern: MONEY, example: '60.00' },
          price: { type: 'string', pattern: DECIMAL, example: '100.00' },
          priceSource: { type: 'string', enum: ['PARTNER', 'DEFAULT'] },
          quantity: {
            type: 'string',
            pattern: DECIMAL,
            example: '0.600',
            description: 'Shares, rounded down to the configured precision.',
          },
          estimatedValue: {
            type: 'string',
            pattern: MONEY,
            example: '60.00',
            description: 'quantity x price, in cents.',
          },
          residualAmount: {
            type: 'string',
            pattern: MONEY,
            example: '0.00',
            description: 'Cash left over because the quantity was rounded down.',
          },
        },
      },
      Order: {
        type: 'object',
        additionalProperties: false,
        required: [
          'orderId',
          'partnerId',
          'orderType',
          'status',
          'currency',
          'totalAmount',
          'quantityPrecision',
          'lines',
          'totals',
          'execution',
          'warnings',
          'createdAt',
        ],
        properties: {
          orderId: { type: 'string', format: 'uuid' },
          partnerId: { type: 'string', example: 'partner-a' },
          orderType: { type: 'string', enum: ['BUY', 'SELL'] },
          status: { type: 'string', enum: ['SCHEDULED'] },
          currency: { type: 'string', enum: ['USD'] },
          totalAmount: { type: 'string', pattern: MONEY, example: '100.00' },
          quantityPrecision: { type: 'integer', minimum: 0, maximum: 10, example: 3 },
          lines: {
            type: 'array',
            minItems: 1,
            items: { $ref: '#/components/schemas/OrderLine' },
          },
          totals: {
            type: 'object',
            additionalProperties: false,
            required: ['allocatedAmount', 'estimatedValue', 'residualAmount'],
            properties: {
              allocatedAmount: { type: 'string', pattern: MONEY },
              estimatedValue: { type: 'string', pattern: MONEY },
              residualAmount: { type: 'string', pattern: MONEY },
            },
          },
          execution: {
            type: 'object',
            additionalProperties: false,
            required: ['executeAt', 'timeZone', 'reason'],
            properties: {
              executeAt: {
                type: 'string',
                format: 'date-time',
                example: '2026-11-23T09:30:00.000-05:00',
              },
              timeZone: { type: 'string', example: 'America/New_York' },
              reason: {
                type: 'string',
                enum: ['MARKET_OPEN', 'BEFORE_MARKET_OPEN', 'AFTER_MARKET_CLOSE', 'WEEKEND'],
              },
            },
          },
          warnings: { type: 'array', items: { type: 'string' } },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      OrderPage: {
        type: 'object',
        additionalProperties: false,
        required: ['data', 'pagination'],
        properties: {
          data: { type: 'array', items: { $ref: '#/components/schemas/Order' } },
          pagination: {
            type: 'object',
            additionalProperties: false,
            required: ['limit', 'offset', 'total'],
            properties: {
              limit: { type: 'integer', minimum: 1, maximum: 100 },
              offset: { type: 'integer', minimum: 0 },
              total: { type: 'integer', minimum: 0 },
            },
          },
        },
      },
      HealthLive: {
        type: 'object',
        additionalProperties: false,
        required: ['status', 'uptimeSeconds', 'timestamp'],
        properties: {
          status: { type: 'string', enum: ['ok'] },
          uptimeSeconds: { type: 'integer', minimum: 0 },
          timestamp: { type: 'string', format: 'date-time' },
        },
      },
      HealthReady: {
        type: 'object',
        additionalProperties: false,
        required: ['status', 'timestamp'],
        properties: {
          status: { type: 'string', enum: ['ready', 'draining'] },
          timestamp: { type: 'string', format: 'date-time' },
        },
      },
      Error: {
        type: 'object',
        additionalProperties: false,
        required: ['error', 'requestId'],
        properties: {
          error: {
            type: 'object',
            additionalProperties: false,
            required: ['code', 'message', 'details'],
            properties: {
              code: {
                type: 'string',
                enum: [...ERROR_CODES],
                description: 'Stable, machine-readable error code. Branch on this, not on message.',
              },
              message: { type: 'string', description: 'Human-readable explanation and guidance.' },
              details: {
                type: 'array',
                description: 'Per-field problems (validation errors); empty otherwise.',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['path', 'message'],
                  properties: { path: { type: 'string' }, message: { type: 'string' } },
                },
              },
            },
          },
          requestId: { type: 'string' },
        },
      },
    },
  },
});

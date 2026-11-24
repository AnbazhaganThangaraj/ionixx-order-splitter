import { ValidationError } from '../../../src/errors/app-error';
import {
  createOrderSchema,
  listOrdersQuerySchema,
  orderIdParamSchema,
} from '../../../src/validators/order.validator';
import { parseOrThrow } from '../../../src/validators/parse';
import { briefExampleRequest, withPartnerPrices } from '../../fixtures/orders';

const expectValidationError = (input: unknown, path: string, message: RegExp): void => {
  try {
    parseOrThrow(createOrderSchema, input);
  } catch (error) {
    expect(error).toBeInstanceOf(ValidationError);
    const details = (error as ValidationError).details;
    expect(details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path, message: expect.stringMatching(message) }),
      ]),
    );
    return;
  }
  throw new Error('expected a ValidationError');
};

const withItem = (item: Record<string, unknown>): unknown => ({
  ...briefExampleRequest,
  portfolio: [item, { symbol: 'TSLA', allocation: '40' }],
});

describe('createOrderSchema', () => {
  describe('valid input', () => {
    it('accepts the example from the brief and converts values to Decimal', () => {
      const command = parseOrThrow(createOrderSchema, briefExampleRequest);

      expect(command.orderType).toBe('BUY');
      expect(command.totalAmount.toString()).toBe('100');
      expect(command.portfolio.map((p) => [p.symbol, p.allocation.toString()])).toEqual([
        ['AAPL', '60'],
        ['TSLA', '40'],
      ]);
    });

    it('keeps the partner price when supplied and leaves it undefined otherwise', () => {
      const command = parseOrThrow(createOrderSchema, withPartnerPrices);

      expect(command.portfolio[0]?.marketPrice?.toString()).toBe('150');
      expect(command.portfolio[1]?.marketPrice).toBeUndefined();
    });

    it('defaults currency to USD', () => {
      const { currency: _ignored, ...withoutCurrency } = briefExampleRequest;
      expect(parseOrThrow(createOrderSchema, withoutCurrency).currency).toBe('USD');
    });

    it('accepts SELL orders', () => {
      expect(
        parseOrThrow(createOrderSchema, { ...briefExampleRequest, orderType: 'SELL' }).orderType,
      ).toBe('SELL');
    });

    it('accepts JSON numbers as well as decimal strings', () => {
      const command = parseOrThrow(createOrderSchema, {
        orderType: 'BUY',
        totalAmount: 100.5,
        portfolio: [
          { symbol: 'AAPL', allocation: 60, marketPrice: 150.25 },
          { symbol: 'TSLA', allocation: 40 },
        ],
      });
      expect(command.totalAmount.toString()).toBe('100.5');
      expect(command.portfolio[0]?.marketPrice?.toString()).toBe('150.25');
    });

    it('normalises symbols to upper case and trims whitespace', () => {
      const command = parseOrThrow(
        createOrderSchema,
        withItem({ symbol: '  aapl ', allocation: '60' }),
      );
      expect(command.portfolio[0]?.symbol).toBe('AAPL');
    });

    it('checks the 100% total with exact decimal arithmetic (no float drift)', () => {
      // 33.3333 + 33.3333 + 33.3334 === 100 exactly; float addition would not be exact.
      const command = parseOrThrow(createOrderSchema, {
        orderType: 'BUY',
        totalAmount: '100',
        portfolio: [
          { symbol: 'A', allocation: '33.3333' },
          { symbol: 'B', allocation: '33.3333' },
          { symbol: 'C', allocation: '33.3334' },
        ],
      });
      expect(command.portfolio).toHaveLength(3);
    });

    it('accepts a single-stock portfolio at 100%', () => {
      const command = parseOrThrow(createOrderSchema, {
        orderType: 'BUY',
        totalAmount: '50',
        portfolio: [{ symbol: 'AAPL', allocation: '100' }],
      });
      expect(command.portfolio).toHaveLength(1);
    });
  });

  describe('invalid input', () => {
    it.each([undefined, null, 'text', 42, []])(
      'rejects a body that is not an object (%p)',
      (body) => {
        expect(() => parseOrThrow(createOrderSchema, body)).toThrow(ValidationError);
      },
    );

    it('rejects a missing orderType', () => {
      const { orderType: _ignored, ...body } = briefExampleRequest;
      expectValidationError(body, 'orderType', /^is required \(one of BUY, SELL\)$/);
    });

    it.each(['HOLD', 'buy', ''])('rejects unsupported orderType %p', (orderType) => {
      expectValidationError({ ...briefExampleRequest, orderType }, 'orderType', /BUY, SELL/);
    });

    it.each([
      ['0', /greater than 0/],
      ['0.00', /greater than 0/],
      ['-10', /positive decimal/],
      ['abc', /positive decimal/],
      ['1e3', /positive decimal/],
      ['1,000', /positive decimal/],
      ['10.001', /at most 2 decimal places/],
      ['1000000000.01', /must not exceed/],
      [true, /decimal string/],
    ])('rejects totalAmount %p', (totalAmount, message) => {
      expectValidationError({ ...briefExampleRequest, totalAmount }, 'totalAmount', message);
    });

    it('rejects a missing totalAmount', () => {
      const { totalAmount: _ignored, ...body } = briefExampleRequest;
      expectValidationError(body, 'totalAmount', /is required/);
    });

    it('rejects NaN and Infinity sent as numbers', () => {
      expectValidationError(
        { ...briefExampleRequest, totalAmount: Number.NaN },
        'totalAmount',
        /decimal/,
      );
      expectValidationError(
        { ...briefExampleRequest, totalAmount: Number.POSITIVE_INFINITY },
        'totalAmount',
        /decimal/,
      );
    });

    it('rejects unsupported currencies', () => {
      expectValidationError({ ...briefExampleRequest, currency: 'EUR' }, 'currency', /USD/);
    });

    it('rejects an empty portfolio', () => {
      expectValidationError({ ...briefExampleRequest, portfolio: [] }, 'portfolio', /at least one/);
    });

    it('rejects a portfolio that is not an array', () => {
      expectValidationError({ ...briefExampleRequest, portfolio: {} }, 'portfolio', /array/);
    });

    it('rejects allocations that do not add up to 100', () => {
      expectValidationError(
        withItem({ symbol: 'AAPL', allocation: '50' }),
        'portfolio',
        /add up to exactly 100 \(got 90, 10 short\)/,
      );
    });

    it.each(['0', '-5', '100.00001'])('rejects allocation %p', (allocation) => {
      expectValidationError(
        withItem({ symbol: 'AAPL', allocation }),
        'portfolio[0].allocation',
        /./,
      );
    });

    it('rejects an allocation above 100', () => {
      expectValidationError(
        withItem({ symbol: 'AAPL', allocation: '101' }),
        'portfolio[0].allocation',
        /must not exceed 100/,
      );
    });

    it('rejects duplicate symbols, including case variants', () => {
      expectValidationError(
        {
          ...briefExampleRequest,
          portfolio: [
            { symbol: 'AAPL', allocation: '50' },
            { symbol: 'aapl', allocation: '50' },
          ],
        },
        'portfolio[1].symbol',
        /duplicate symbol "AAPL"/,
      );
    });

    it.each(['', '1ABC', 'AA PL', 'TOOLONGSYMBOL1', 'AAPL$'])('rejects symbol %p', (symbol) => {
      expectValidationError(
        withItem({ symbol, allocation: '60' }),
        'portfolio[0].symbol',
        /ticker/,
      );
    });

    it.each([
      ['0', /greater than 0/],
      ['-150', /positive decimal/],
      ['abc', /positive decimal/],
      ['', /positive decimal/],
      [null, /is required/],
    ])(
      'rejects an invalid supplied marketPrice %p instead of falling back to the default',
      (marketPrice, message) => {
        expectValidationError(
          withItem({ symbol: 'AAPL', allocation: '60', marketPrice }),
          'portfolio[0].marketPrice',
          message,
        );
      },
    );

    it('rejects unknown fields so typos cannot silently change the result', () => {
      expectValidationError(
        withItem({ symbol: 'AAPL', allocation: '60', markePrice: '150' }),
        'portfolio[0]',
        /unknown field\(s\): markePrice/,
      );
      expectValidationError(
        { ...briefExampleRequest, amount: '100' },
        'body',
        /unknown field\(s\): amount/,
      );
    });

    it('reports every problem at once', () => {
      try {
        parseOrThrow(createOrderSchema, { orderType: 'HOLD', totalAmount: '-1', portfolio: [] });
        throw new Error('expected a ValidationError');
      } catch (error) {
        expect((error as ValidationError).details.map((d) => d.path)).toEqual([
          'orderType',
          'totalAmount',
          'portfolio',
        ]);
      }
    });
  });
});

describe('listOrdersQuerySchema', () => {
  it('applies default paging', () => {
    expect(parseOrThrow(listOrdersQuerySchema, {}, 'query')).toEqual({ limit: 20, offset: 0 });
  });

  it('parses query-string values', () => {
    expect(
      parseOrThrow(listOrdersQuerySchema, { limit: '5', offset: '10', orderType: 'SELL' }),
    ).toEqual({
      limit: 5,
      offset: 10,
      orderType: 'SELL',
    });
  });

  it.each([
    { limit: '0' },
    { limit: '101' },
    { limit: '2.5' },
    { limit: 'abc' },
    { offset: '-1' },
    { orderType: 'HOLD' },
    { page: '2' },
  ])('rejects %p', (query) => {
    expect(() => parseOrThrow(listOrdersQuerySchema, query, 'query')).toThrow(ValidationError);
  });
});

describe('orderIdParamSchema', () => {
  it('accepts a UUID', () => {
    const orderId = '3f2b8c1e-4d5a-4b6c-9e7f-0a1b2c3d4e5f';
    expect(parseOrThrow(orderIdParamSchema, { orderId })).toEqual({ orderId });
  });

  it('rejects a non-UUID', () => {
    expect(() => parseOrThrow(orderIdParamSchema, { orderId: '123' })).toThrow(ValidationError);
  });
});

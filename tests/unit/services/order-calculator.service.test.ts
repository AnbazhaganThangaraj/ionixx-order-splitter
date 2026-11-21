import { OrderCalculator } from '../../../src/services/order-calculator.service';
import { createOrderSchema } from '../../../src/validators/order.validator';
import { briefExampleRequest, withPartnerPrices } from '../../fixtures/orders';

const calculator = (quantityPrecision = 3): OrderCalculator =>
  new OrderCalculator({ defaultStockPrice: '100', quantityPrecision, moneyPrecision: 2 });

const command = (body: unknown) => createOrderSchema.parse(body);

describe('OrderCalculator', () => {
  it('produces the brief example: $60 of AAPL and $40 of TSLA at the default $100', () => {
    const result = calculator().calculate(command(briefExampleRequest));

    expect(result.lines).toEqual([
      {
        symbol: 'AAPL',
        allocationPercent: '60',
        allocatedAmount: '60.00',
        price: '100.00',
        priceSource: 'DEFAULT',
        quantity: '0.600',
        estimatedValue: '60.00',
        residualAmount: '0.00',
      },
      {
        symbol: 'TSLA',
        allocationPercent: '40',
        allocatedAmount: '40.00',
        price: '100.00',
        priceSource: 'DEFAULT',
        quantity: '0.400',
        estimatedValue: '40.00',
        residualAmount: '0.00',
      },
    ]);
    expect(result.totals).toEqual({
      allocatedAmount: '100.00',
      estimatedValue: '100.00',
      residualAmount: '0.00',
    });
    expect(result.warnings).toEqual([]);
  });

  it('uses the partner price where supplied and the default elsewhere', () => {
    const [aapl, tsla] = calculator().calculate(command(withPartnerPrices)).lines;

    expect(aapl).toMatchObject({ price: '150.00', priceSource: 'PARTNER', quantity: '0.400' });
    expect(tsla).toMatchObject({ price: '100.00', priceSource: 'DEFAULT', quantity: '0.400' });
  });

  it('changes quantity precision through configuration only', () => {
    const body = {
      orderType: 'BUY',
      totalAmount: '100',
      portfolio: [{ symbol: 'AAPL', allocation: '100', marketPrice: '3' }],
    };
    expect(calculator(3).calculate(command(body)).lines[0]?.quantity).toBe('33.333');
    expect(calculator(7).calculate(command(body)).lines[0]?.quantity).toBe('33.3333333');
  });

  it('calculates SELL orders with the same value-based maths as BUY', () => {
    const buy = calculator().calculate(command(withPartnerPrices));
    const sell = calculator().calculate(command({ ...withPartnerPrices, orderType: 'SELL' }));
    expect(sell).toEqual(buy);
  });

  it('keeps the totals consistent for an uneven three-way split', () => {
    const result = calculator().calculate(
      command({
        orderType: 'BUY',
        totalAmount: '100',
        portfolio: [
          { symbol: 'AAA', allocation: '33.3333', marketPrice: '187.43' },
          { symbol: 'BBB', allocation: '33.3333', marketPrice: '42.10' },
          { symbol: 'CCC', allocation: '33.3334', marketPrice: '999.99' },
        ],
      }),
    );

    expect(result.lines.map((l) => l.allocatedAmount)).toEqual(['33.33', '33.33', '33.34']);
    expect(result.lines.map((l) => l.quantity)).toEqual(['0.177', '0.791', '0.033']);
    // 0.177 x 187.43 = 33.17511 -> 33.18 ; 0.791 x 42.10 = 33.3011 -> 33.30 ; 0.033 x 999.99 = 32.99967 -> 33.00
    expect(result.lines.map((l) => l.residualAmount)).toEqual(['0.15', '0.03', '0.34']);
    expect(result.totals).toEqual({
      allocatedAmount: '100.00',
      estimatedValue: '99.48',
      residualAmount: '0.52',
    });
  });

  it('warns when an allocation is too small to trade any shares', () => {
    const result = calculator().calculate(
      command({
        orderType: 'BUY',
        totalAmount: '1',
        portfolio: [
          { symbol: 'AAPL', allocation: '99.5' },
          { symbol: 'TINY', allocation: '0.5', marketPrice: '5000' },
        ],
      }),
    );

    expect(result.lines[1]).toMatchObject({
      allocatedAmount: '0.01',
      quantity: '0.000',
      residualAmount: '0.01',
    });
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/^TINY: allocated amount 0.01 is too small/);
  });

  it('keeps extra price precision in the output', () => {
    const result = calculator().calculate(
      command({
        orderType: 'BUY',
        totalAmount: '10',
        portfolio: [{ symbol: 'PENNY', allocation: '100', marketPrice: '0.1234' }],
      }),
    );
    expect(result.lines[0]).toMatchObject({ price: '0.1234', quantity: '81.037' });
  });
});

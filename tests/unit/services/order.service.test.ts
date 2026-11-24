import { OrderNotExecutableError, OrderNotFoundError } from '../../../src/domain/errors';
import type { CreateOrderCommand } from '../../../src/domain/order.commands';
import type { Order, OrderExecution } from '../../../src/domain/order.types';
import { Decimal } from '../../../src/lib/decimal';
import type { AuditLog } from '../../../src/lib/audit';
import type { OrderPage, OrderRepository } from '../../../src/repositories/order.repository';
import type { MarketScheduler } from '../../../src/services/market-scheduler.service';
import {
  type OrderCalculation,
  OrderCalculator,
  type PortfolioCalculator,
} from '../../../src/services/order-calculator.service';
import { OrderService } from '../../../src/services/order.service';
import { makeOrder } from '../../fixtures/order-factory';

const NOW = new Date('2026-11-23T15:00:00.000Z');
const EXECUTION: OrderExecution = {
  executeAt: '2026-11-23T10:00:00.000-05:00',
  timeZone: 'America/New_York',
  reason: 'MARKET_OPEN',
};

const command: CreateOrderCommand = {
  orderType: 'SELL',
  totalAmount: new Decimal('100'),
  currency: 'USD',
  portfolio: [
    { symbol: 'AAPL', allocation: new Decimal(60) },
    { symbol: 'TSLA', allocation: new Decimal(40), marketPrice: new Decimal('200') },
  ],
};

/** Hand-written fakes: the service depends only on interfaces, so no mocking library is needed. */
const setup = (
  overrides: { calculator?: PortfolioCalculator; repository?: Partial<OrderRepository> } = {},
) => {
  const saved: Order[] = [];
  const audit: { event: string; details: Record<string, unknown> }[] = [];
  const scheduledAt: Date[] = [];

  const repository: OrderRepository = {
    save: (order) => {
      saved.push(order);
      return Promise.resolve();
    },
    findById: (partnerId, orderId) =>
      Promise.resolve(saved.find((o) => o.orderId === orderId && o.partnerId === partnerId)),
    list: (): Promise<OrderPage> => Promise.resolve({ items: saved, total: saved.length }),
    ...overrides.repository,
  };
  const scheduler: MarketScheduler = {
    nextExecution: (at) => {
      scheduledAt.push(at);
      return EXECUTION;
    },
  };
  const auditLog: AuditLog = {
    record: (event, details) => {
      audit.push({ event, details });
    },
  };

  const service = new OrderService({
    repository,
    calculator:
      overrides.calculator ??
      new OrderCalculator({ defaultStockPrice: '100', quantityPrecision: 3, moneyPrecision: 2 }),
    scheduler,
    clock: { now: () => NOW },
    generateId: () => 'order-1',
    audit: auditLog,
  });
  return { service, saved, audit, scheduledAt };
};

describe('OrderService', () => {
  describe('createOrder', () => {
    it('builds the order from the calculation, the clock, the scheduler and the id generator', async () => {
      const { service, scheduledAt } = setup();

      const order = await service.createOrder('partner-a', command);

      expect(order).toMatchObject({
        orderId: 'order-1',
        partnerId: 'partner-a',
        orderType: 'SELL',
        status: 'SCHEDULED',
        currency: 'USD',
        totalAmount: '100.00',
        quantityPrecision: 3,
        execution: EXECUTION,
        createdAt: NOW.toISOString(),
        warnings: [],
      });
      expect(order.lines.map((l) => [l.symbol, l.allocatedAmount, l.quantity])).toEqual([
        ['AAPL', '60.00', '0.600'],
        ['TSLA', '40.00', '0.200'],
      ]);
      expect(scheduledAt).toEqual([NOW]);
    });

    it('saves the order and records an audit event with identifiers only', async () => {
      const { service, saved, audit } = setup();

      const order = await service.createOrder('partner-a', command);

      expect(saved).toEqual([order]);
      expect(audit).toEqual([
        {
          event: 'order.created',
          details: {
            orderId: 'order-1',
            partnerId: 'partner-a',
            orderType: 'SELL',
            lineCount: 2,
            executeAt: EXECUTION.executeAt,
          },
        },
      ]);
    });

    it('rejects an order where every line rounds down to zero shares, without saving or auditing', async () => {
      const { service, saved, audit } = setup();
      const tiny: CreateOrderCommand = { ...command, totalAmount: new Decimal('0.01') };

      const attempt = service.createOrder('partner-a', tiny);

      await expect(attempt).rejects.toBeInstanceOf(OrderNotExecutableError);
      await expect(attempt).rejects.toMatchObject({
        quantityPrecision: 3,
        lineProblems: [{ index: 0 }, { index: 1 }],
      });
      expect(saved).toEqual([]);
      expect(audit).toEqual([]);
    });

    it('accepts an order where only some lines round down to zero', async () => {
      const stub: OrderCalculation = {
        totalAmount: '1.00',
        quantityPrecision: 3,
        lines: makeOrder().lines.concat(makeOrder().lines),
        totals: makeOrder().totals,
        warnings: ['TINY: too small'],
        untradableLines: [{ index: 1, message: 'TINY: too small' }],
      };
      const { service } = setup({ calculator: { calculate: () => stub } });

      const order = await service.createOrder('partner-a', command);
      expect(order.warnings).toEqual(['TINY: too small']);
    });

    it('does not audit when saving fails, and propagates the error', async () => {
      const { service, audit } = setup({
        repository: { save: () => Promise.reject(new Error('storage down')) },
      });

      await expect(service.createOrder('partner-a', command)).rejects.toThrow('storage down');
      expect(audit).toEqual([]);
    });
  });

  describe('getOrder', () => {
    it("returns the partner's own order", async () => {
      const { service } = setup();
      const created = await service.createOrder('partner-a', command);
      await expect(service.getOrder('partner-a', created.orderId)).resolves.toEqual(created);
    });

    it("throws OrderNotFoundError for an unknown id or another partner's order", async () => {
      const { service } = setup();
      const created = await service.createOrder('partner-a', command);

      await expect(service.getOrder('partner-b', created.orderId)).rejects.toBeInstanceOf(
        OrderNotFoundError,
      );
      await expect(service.getOrder('partner-a', 'missing')).rejects.toMatchObject({
        orderId: 'missing',
        message: 'Order missing not found',
      });
    });
  });

  describe('listOrders', () => {
    it('passes the partner id and the query to the repository', async () => {
      const calls: unknown[] = [];
      const { service } = setup({
        repository: {
          list: (filter) => {
            calls.push(filter);
            return Promise.resolve({ items: [], total: 0 });
          },
        },
      });

      await service.listOrders('partner-a', { limit: 5, offset: 10, orderType: 'BUY' });
      expect(calls).toEqual([{ partnerId: 'partner-a', limit: 5, offset: 10, orderType: 'BUY' }]);
    });
  });
});

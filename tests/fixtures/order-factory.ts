import { randomUUID } from 'node:crypto';
import type { OrderType } from '../../src/domain/order.enums';
import type { Order } from '../../src/domain/order.types';

export const makeOrder = (overrides: Partial<Order> & { orderType?: OrderType } = {}): Order => ({
  orderId: randomUUID(),
  partnerId: 'partner-a',
  orderType: 'BUY',
  status: 'SCHEDULED',
  currency: 'USD',
  totalAmount: '100.00',
  quantityPrecision: 3,
  lines: [
    {
      symbol: 'AAPL',
      allocationPercent: '100',
      allocatedAmount: '100.00',
      price: '100.00',
      priceSource: 'DEFAULT',
      quantity: '1.000',
      estimatedValue: '100.00',
      residualAmount: '0.00',
    },
  ],
  totals: { allocatedAmount: '100.00', estimatedValue: '100.00', residualAmount: '0.00' },
  execution: {
    executeAt: '2026-11-23T09:30:00.000-05:00',
    timeZone: 'America/New_York',
    reason: 'BEFORE_MARKET_OPEN',
  },
  warnings: [],
  createdAt: '2026-11-23T13:00:00.000Z',
  ...overrides,
});

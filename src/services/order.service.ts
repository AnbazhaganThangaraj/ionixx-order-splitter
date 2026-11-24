import type { Order } from '../domain/order.types';
import { NotFoundError } from '../errors/app-error';
import type { Clock } from '../lib/clock';
import type { OrderPage, OrderRepository } from '../repositories/order.repository';
import type { CreateOrderCommand, ListOrdersQuery } from '../validators/order.validator';
import type { MarketScheduler } from './market-scheduler.service';
import type { OrderCalculator } from './order-calculator.service';

export interface OrderServiceDependencies {
  readonly repository: OrderRepository;
  readonly calculator: OrderCalculator;
  readonly scheduler: MarketScheduler;
  readonly clock: Clock;
  readonly generateId: () => string;
  readonly quantityPrecision: number;
  readonly moneyPrecision: number;
}

/**
 * Use cases for orders. Coordinates calculation, scheduling and storage; holds
 * no HTTP concerns and no maths of its own.
 */
export class OrderService {
  constructor(private readonly deps: OrderServiceDependencies) {}

  async createOrder(partnerId: string, command: CreateOrderCommand): Promise<Order> {
    const now = this.deps.clock.now();
    const { lines, totals, warnings } = this.deps.calculator.calculate(command);

    const order: Order = {
      orderId: this.deps.generateId(),
      partnerId,
      orderType: command.orderType,
      status: 'SCHEDULED',
      currency: command.currency,
      totalAmount: command.totalAmount.toFixed(this.deps.moneyPrecision),
      quantityPrecision: this.deps.quantityPrecision,
      lines,
      totals,
      execution: this.deps.scheduler.nextExecution(now),
      warnings,
      createdAt: now.toISOString(),
    };

    await this.deps.repository.save(order);
    return order;
  }

  async getOrder(partnerId: string, orderId: string): Promise<Order> {
    const order = await this.deps.repository.findById(partnerId, orderId);
    // Another partner's order is reported as "not found", not "forbidden",
    // so ids cannot be probed to learn that an order exists.
    if (order === undefined) {
      throw new NotFoundError(`Order ${orderId} not found`);
    }
    return order;
  }

  listOrders(partnerId: string, query: ListOrdersQuery): Promise<OrderPage> {
    return this.deps.repository.list({ partnerId, ...query });
  }
}

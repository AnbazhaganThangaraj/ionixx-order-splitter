import type { CreateOrderCommand, ListOrdersQuery } from '../domain/order.commands';
import { OrderNotExecutableError, OrderNotFoundError } from '../domain/errors';
import type { Order } from '../domain/order.types';
import type { AuditLog } from '../lib/audit';
import type { Clock } from '../lib/clock';
import type { OrderPage, OrderRepository } from '../repositories/order.repository';
import type { MarketScheduler } from './market-scheduler.service';
import type { PortfolioCalculator } from './order-calculator.service';

/** The order use cases, as seen by the HTTP layer (and by test doubles). */
export interface OrderUseCases {
  createOrder(partnerId: string, command: CreateOrderCommand): Promise<Order>;
  getOrder(partnerId: string, orderId: string): Promise<Order>;
  listOrders(partnerId: string, query: ListOrdersQuery): Promise<OrderPage>;
}

export interface OrderServiceDependencies {
  readonly repository: OrderRepository;
  readonly calculator: PortfolioCalculator;
  readonly scheduler: MarketScheduler;
  readonly clock: Clock;
  readonly generateId: () => string;
  readonly audit: AuditLog;
}

/**
 * Implements the order use cases by coordinating calculation, scheduling and storage.
 * Depends only on ports (interfaces) and domain types: no HTTP, no validation library,
 * no maths of its own. Business-rule failures are thrown as domain errors.
 */
export class OrderService implements OrderUseCases {
  constructor(private readonly deps: OrderServiceDependencies) {}

  async createOrder(partnerId: string, command: CreateOrderCommand): Promise<Order> {
    const calculation = this.deps.calculator.calculate(command);

    // Business rule: an order must trade something. If every line rounds down to zero
    // shares there is nothing to execute, so the order is rejected rather than scheduled.
    if (calculation.untradableLines.length === calculation.lines.length) {
      throw new OrderNotExecutableError(calculation.quantityPrecision, calculation.untradableLines);
    }

    const now = this.deps.clock.now();
    const order: Order = {
      orderId: this.deps.generateId(),
      partnerId,
      orderType: command.orderType,
      status: 'SCHEDULED',
      currency: command.currency,
      totalAmount: calculation.totalAmount,
      quantityPrecision: calculation.quantityPrecision,
      lines: calculation.lines,
      totals: calculation.totals,
      execution: this.deps.scheduler.nextExecution(now),
      warnings: calculation.warnings,
      createdAt: now.toISOString(),
    };

    await this.deps.repository.save(order);
    // Identifiers only: amounts and holdings stay out of logs.
    this.deps.audit.record('order.created', {
      orderId: order.orderId,
      partnerId,
      orderType: order.orderType,
      lineCount: order.lines.length,
      executeAt: order.execution.executeAt,
    });
    return order;
  }

  async getOrder(partnerId: string, orderId: string): Promise<Order> {
    const order = await this.deps.repository.findById(partnerId, orderId);
    // Another partner's order is reported as "not found", not "forbidden",
    // so ids cannot be probed to learn that an order exists.
    if (order === undefined) {
      throw new OrderNotFoundError(orderId);
    }
    return order;
  }

  listOrders(partnerId: string, query: ListOrdersQuery): Promise<OrderPage> {
    return this.deps.repository.list({ partnerId, ...query });
  }
}

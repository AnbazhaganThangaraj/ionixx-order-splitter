import type { Order } from '../domain/order.types';
import type { ListOrdersFilter, OrderPage, OrderRepository } from './order.repository';

/**
 * Process-memory store. Data is intentionally lost when the application
 * restarts, as the brief requires.
 *
 * A Map keeps insertion order, which is creation order, so "newest first" is a
 * reverse walk with no sorting and no tie-break ambiguity for equal timestamps.
 * Orders are cloned on the way in and out so callers can never mutate stored data.
 */
export class InMemoryOrderRepository implements OrderRepository {
  private readonly orders = new Map<string, Order>();

  save(order: Order): Promise<void> {
    if (this.orders.has(order.orderId)) {
      return Promise.reject(new Error(`Order ${order.orderId} already exists`));
    }
    this.orders.set(order.orderId, structuredClone(order));
    return Promise.resolve();
  }

  findById(orderId: string): Promise<Order | undefined> {
    const order = this.orders.get(orderId);
    return Promise.resolve(order === undefined ? undefined : structuredClone(order));
  }

  list({ limit, offset, orderType }: ListOrdersFilter): Promise<OrderPage> {
    const newestFirst = [...this.orders.values()].reverse();
    const matching =
      orderType === undefined ? newestFirst : newestFirst.filter((o) => o.orderType === orderType);

    return Promise.resolve({
      items: matching.slice(offset, offset + limit).map((order) => structuredClone(order)),
      total: matching.length,
    });
  }
}

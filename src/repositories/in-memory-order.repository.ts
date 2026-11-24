import type { OrderType } from '../domain/order.enums';
import type { Order } from '../domain/order.types';
import type { ListOrdersFilter, OrderPage, OrderRepository } from './order.repository';

/**
 * Process-memory store. Data is intentionally lost when the application
 * restarts, as the brief requires.
 *
 * Orders are kept by id, plus an append-only list of ids per partner and per
 * (partner, order type). Lists are in creation order, so "newest first" paging is a
 * slice from the end: O(limit), independent of how many orders exist. (The first
 * version copied and reversed every order on each list call; the load test showed
 * that collapsing to ~120 req/s at 140k orders. See docs/PERFORMANCE.md.)
 *
 * Orders are cloned on the way in and out so callers can never mutate stored data.
 */
export class InMemoryOrderRepository implements OrderRepository {
  private readonly orders = new Map<string, Order>();
  private readonly idsByPartner = new Map<string, string[]>();
  private readonly idsByPartnerAndType = new Map<string, string[]>();

  save(order: Order): Promise<void> {
    if (this.orders.has(order.orderId)) {
      return Promise.reject(new Error(`Order ${order.orderId} already exists`));
    }
    this.orders.set(order.orderId, structuredClone(order));
    this.append(this.idsByPartner, order.partnerId, order.orderId);
    this.append(
      this.idsByPartnerAndType,
      InMemoryOrderRepository.typeKey(order.partnerId, order.orderType),
      order.orderId,
    );
    return Promise.resolve();
  }

  findById(partnerId: string, orderId: string): Promise<Order | undefined> {
    const order = this.orders.get(orderId);
    return Promise.resolve(
      order === undefined || order.partnerId !== partnerId ? undefined : structuredClone(order),
    );
  }

  list({ partnerId, limit, offset, orderType }: ListOrdersFilter): Promise<OrderPage> {
    const ids =
      (orderType === undefined
        ? this.idsByPartner.get(partnerId)
        : this.idsByPartnerAndType.get(InMemoryOrderRepository.typeKey(partnerId, orderType))) ??
      [];

    // Newest first: offset 0 is the last id appended.
    const end = ids.length - offset;
    const start = Math.max(0, end - limit);
    const pageIds = end > 0 ? ids.slice(start, end).reverse() : [];

    return Promise.resolve({
      items: pageIds.flatMap((id) => {
        const order = this.orders.get(id);
        return order === undefined ? [] : [structuredClone(order)];
      }),
      total: ids.length,
    });
  }

  private append(index: Map<string, string[]>, key: string, orderId: string): void {
    const ids = index.get(key);
    if (ids === undefined) index.set(key, [orderId]);
    else ids.push(orderId);
  }

  private static typeKey(partnerId: string, orderType: OrderType): string {
    return `${partnerId}\u0000${orderType}`;
  }
}

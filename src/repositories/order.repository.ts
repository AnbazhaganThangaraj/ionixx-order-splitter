import type { ListOrdersQuery } from '../domain/order.commands';
import type { Order } from '../domain/order.types';

/** A list query scoped to one partner. */
export interface ListOrdersFilter extends ListOrdersQuery {
  readonly partnerId: string;
}

export interface OrderPage {
  readonly items: Order[];
  /** Number of orders matching the filter, before paging. */
  readonly total: number;
}

/**
 * Storage port. Methods are async even though the POC store is in memory, so a
 * database-backed implementation (e.g. PostgreSQL) can be dropped in without
 * changing the service or controllers.
 */
export interface OrderRepository {
  save(order: Order): Promise<void>;
  /** Returns undefined when the order does not exist OR belongs to another partner. */
  findById(partnerId: string, orderId: string): Promise<Order | undefined>;
  /** The partner's own orders, newest first. */
  list(filter: ListOrdersFilter): Promise<OrderPage>;
}

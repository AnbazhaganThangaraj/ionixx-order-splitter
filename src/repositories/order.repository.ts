import type { OrderType } from '../domain/order.enums';
import type { Order } from '../domain/order.types';

export interface ListOrdersFilter {
  readonly partnerId: string;
  readonly limit: number;
  readonly offset: number;
  readonly orderType?: OrderType | undefined;
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

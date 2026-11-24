import type { Request, Response } from 'express';
import { getPartnerId } from '../middlewares/api-key-auth.middleware';
import type { OrderService } from '../services/order.service';
import {
  createOrderSchema,
  listOrdersQuerySchema,
  orderIdParamSchema,
} from '../validators/order.validator';
import { parseOrThrow } from '../validators/parse';

/**
 * Thin HTTP adapter: validate input, call the service, shape the response.
 * Express 5 forwards rejected promises to the error middleware automatically.
 */
export class OrderController {
  constructor(private readonly service: OrderService) {}

  create = async (req: Request, res: Response): Promise<void> => {
    const command = parseOrThrow(createOrderSchema, req.body);
    const order = await this.service.createOrder(getPartnerId(res.locals), command);
    res.status(201).location(`${req.baseUrl}/${order.orderId}`).json(order);
  };

  list = async (req: Request, res: Response): Promise<void> => {
    const query = parseOrThrow(listOrdersQuerySchema, req.query, 'query');
    const page = await this.service.listOrders(getPartnerId(res.locals), query);
    res.status(200).json({
      data: page.items,
      pagination: { limit: query.limit, offset: query.offset, total: page.total },
    });
  };

  getById = async (req: Request, res: Response): Promise<void> => {
    const { orderId } = parseOrThrow(orderIdParamSchema, req.params, 'params');
    const order = await this.service.getOrder(getPartnerId(res.locals), orderId);
    res.status(200).json(order);
  };
}

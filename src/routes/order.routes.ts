import { Router } from 'express';
import type { OrderController } from '../controllers/order.controller';
import { requireJson } from '../middlewares/require-json.middleware';

export const createOrderRouter = (controller: OrderController): Router => {
  const router = Router();

  router.post('/', requireJson(), controller.create);
  router.get('/', controller.list);
  router.get('/:orderId', controller.getById);

  return router;
};

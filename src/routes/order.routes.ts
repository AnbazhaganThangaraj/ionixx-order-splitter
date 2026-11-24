import { Router } from 'express';
import type { OrderController } from '../controllers/order.controller';
import { idempotency } from '../middlewares/idempotency.middleware';
import { requireJson } from '../middlewares/require-json.middleware';
import type { AuditLog } from '../lib/audit';
import type { IdempotencyStore } from '../repositories/idempotency.store';

export const createOrderRouter = (
  controller: OrderController,
  idempotencyStore: IdempotencyStore,
  audit: AuditLog,
): Router => {
  const router = Router();

  router.post('/', requireJson(), idempotency(idempotencyStore, audit), controller.create);
  router.get('/', controller.list);
  router.get('/:orderId', controller.getById);

  return router;
};

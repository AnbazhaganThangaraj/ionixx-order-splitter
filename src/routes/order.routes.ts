import express, { Router } from 'express';
import type { OrderController } from '../controllers/order.controller';
import { idempotency } from '../middlewares/idempotency.middleware';
import { methodNotAllowed } from '../middlewares/method-not-allowed.middleware';
import { requireJson } from '../middlewares/require-json.middleware';
import type { AuditLog } from '../lib/audit';
import type { IdempotencyStore } from '../repositories/idempotency.store';
import { JSON_BODY_LIMIT } from '../lib/http-limits';

export const createOrderRouter = (
  controller: OrderController,
  idempotencyStore: IdempotencyStore,
  audit: AuditLog,
): Router => {
  const router = Router();

  // Mounted after apiRateLimit -> apiKeyAuth -> partnerRateLimit (app.ts): the body is
  // only read once the caller is authenticated and within its limits.
  router.post(
    '/',
    requireJson(),
    express.json({ limit: JSON_BODY_LIMIT }),
    idempotency(idempotencyStore, audit),
    controller.create,
  );
  router.get('/', controller.list);
  router.get('/:orderId', controller.getById);
  router.all('/', methodNotAllowed(['GET', 'POST']));
  router.all('/:orderId', methodNotAllowed(['GET']));

  return router;
};

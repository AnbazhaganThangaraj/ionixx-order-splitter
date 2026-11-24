import { randomUUID } from 'node:crypto';
import express, { type Express } from 'express';
import type { AppConfig } from './config/app.config';
import { OrderController } from './controllers/order.controller';
import { type Clock, systemClock } from './lib/clock';
import { AppLifecycle } from './lib/lifecycle';
import { createLogger, type Logger } from './lib/logger';
import { apiKeyAuth } from './middlewares/api-key-auth.middleware';
import { connectionDrain } from './middlewares/connection-drain.middleware';
import { errorHandler } from './middlewares/error.middleware';
import { notFound } from './middlewares/not-found.middleware';
import { apiRateLimit } from './middlewares/rate-limit.middleware';
import { requestId } from './middlewares/request-id.middleware';
import {
  apiSecurityHeaders,
  docsSecurityHeaders,
  noStore,
} from './middlewares/security.middleware';
import { recordMountPath, responseTimeLogger } from './middlewares/response-time.middleware';
import { type IdempotencyStore, InMemoryIdempotencyStore } from './repositories/idempotency.store';
import { InMemoryOrderRepository } from './repositories/in-memory-order.repository';
import type { OrderRepository } from './repositories/order.repository';
import { createDocsRouter } from './routes/docs.routes';
import { createHealthRouter } from './routes/health.routes';
import { createOrderRouter } from './routes/order.routes';
import { WeekdayMarketScheduler, type MarketScheduler } from './services/market-scheduler.service';
import { OrderCalculator } from './services/order-calculator.service';
import { OrderService } from './services/order.service';

/** Replaceable collaborators, mainly so tests can fix the clock or inject failures. */
export interface AppDependencies {
  readonly logger?: Logger;
  readonly lifecycle?: AppLifecycle;
  readonly clock?: Clock;
  readonly repository?: OrderRepository;
  readonly idempotencyStore?: IdempotencyStore;
  readonly scheduler?: MarketScheduler;
  readonly generateId?: () => string;
}

/**
 * Composition root: wires config and dependencies together and builds the
 * Express app without starting a listener, so tests can drive it in-process.
 */
export const createApp = (config: AppConfig, deps: AppDependencies = {}): Express => {
  const logger = deps.logger ?? createLogger(config.logLevel);
  const clock = deps.clock ?? systemClock;
  const lifecycle = deps.lifecycle ?? new AppLifecycle();
  const idempotencyStore =
    deps.idempotencyStore ??
    new InMemoryIdempotencyStore(clock, config.idempotency.ttlSeconds * 1000);

  const orderService = new OrderService({
    repository: deps.repository ?? new InMemoryOrderRepository(),
    calculator: new OrderCalculator(config.order),
    scheduler: deps.scheduler ?? new WeekdayMarketScheduler(config.market),
    clock,
    generateId: deps.generateId ?? randomUUID,
    quantityPrecision: config.order.quantityPrecision,
    moneyPrecision: config.order.moneyPrecision,
  });

  const app = express();
  app.disable('x-powered-by');
  // Behind N proxies, req.ip must be the client's address (used by rate limiting and logs),
  // taken from X-Forwarded-For. 0 means "no proxy": the header is ignored and cannot be spoofed.
  app.set('trust proxy', config.http.trustProxyHops === 0 ? false : config.http.trustProxyHops);

  app.use(apiSecurityHeaders());
  app.use(connectionDrain(lifecycle));
  app.use(requestId());
  app.use(responseTimeLogger(logger));
  app.use(express.json({ limit: '100kb' }));

  app.use('/health', recordMountPath(), createHealthRouter(lifecycle));
  app.use('/docs', recordMountPath(), docsSecurityHeaders(), createDocsRouter(config));
  app.use(
    '/api/v1/orders',
    recordMountPath(),
    noStore(),
    apiRateLimit(config.http.rateLimit),
    apiKeyAuth(config.auth.apiKeys),
    createOrderRouter(new OrderController(orderService), idempotencyStore),
  );

  app.use(notFound());
  app.use(errorHandler(logger));

  return app;
};

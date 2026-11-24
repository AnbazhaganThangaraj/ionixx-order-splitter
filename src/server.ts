import 'dotenv/config';
import { createApp } from './app';
import { ConfigError, loadConfig } from './config/app.config';
import { AppLifecycle } from './lib/lifecycle';
import { createLogger } from './lib/logger';

const SHUTDOWN_GRACE_MS = 10_000;

const start = (): void => {
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      // Logger is configured from config, so report config problems directly.
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }

  const logger = createLogger(config.logLevel);
  if (config.auth.apiKeys.length === 0) {
    logger.warn(
      'API key authentication is DISABLED because API_KEYS is not set. ' +
        'Allowed for local development only; production refuses to start without keys.',
    );
  }

  if (config.nodeEnv === 'production' && config.auth.plaintextKeysConfigured) {
    logger.warn(
      'Plaintext API keys are configured via API_KEYS. Prefer API_KEY_HASHES in production ' +
        '(generate with: npm run hash-key -- --generate).',
    );
  }

  const lifecycle = new AppLifecycle();
  const app = createApp(config, { logger, lifecycle });

  const server = app.listen(config.port, () => {
    logger.info(
      {
        port: config.port,
        quantityPrecision: config.order.quantityPrecision,
        defaultStockPrice: config.order.defaultStockPrice,
        authenticatedPartners: [...new Set(config.auth.apiKeys.map((k) => k.partnerId))],
        market: config.market,
      },
      `Order splitter API listening on http://localhost:${config.port}`,
    );
  });

  // Slow-client protection (slowloris): cap how long headers and whole requests may take.
  server.headersTimeout = 66_000;
  server.requestTimeout = 30_000;
  // Keep idle connections open longer than a typical load balancer's idle timeout (60s),
  // otherwise the LB may reuse a socket Node has just closed and return a 502.
  server.keepAliveTimeout = 65_000;

  /**
   * Graceful shutdown: fail readiness so no new traffic arrives, stop accepting
   * connections, let in-flight requests finish, then exit. Force-exit after a grace period.
   */
  const shutdown = (signal: string): void => {
    if (lifecycle.isDraining) return;
    lifecycle.startDraining();
    logger.info({ signal }, 'Shutting down: draining connections');

    server.close((error) => {
      logger.info('HTTP server closed');
      process.exit(error ? 1 : 0);
    });
    server.closeIdleConnections();
    setTimeout(() => {
      logger.warn('Grace period elapsed; forcing exit');
      process.exit(1);
    }, SHUTDOWN_GRACE_MS).unref();
  };
  process.on('SIGTERM', () => {
    shutdown('SIGTERM');
  });
  process.on('SIGINT', () => {
    shutdown('SIGINT');
  });
};

start();

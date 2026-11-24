import 'dotenv/config';
import { createApp } from './app';
import { ConfigError, loadConfig } from './config/app.config';
import { AppLifecycle } from './lib/lifecycle';
import { createLogger } from './lib/logger';
import { registerProcessHandlers } from './lib/process-handlers';

/** Time allowed for in-flight requests to finish on SIGTERM/SIGINT. */
const SHUTDOWN_GRACE_MS = 10_000;
/** After an uncaught error the state is suspect: drain briefly, then exit. */
const FATAL_GRACE_MS = 3_000;

const describeListenError = (error: NodeJS.ErrnoException, port: number): string => {
  switch (error.code) {
    case 'EADDRINUSE':
      return `port ${port} is already in use (is another instance running?)`;
    case 'EACCES':
      return `permission denied to listen on port ${port}`;
    default:
      return error.message;
  }
};

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
  if (config.auth.disabled) {
    logger.warn(
      'API key authentication is DISABLED (AUTH_DISABLED=true). Local development only; ' +
        'it is refused when NODE_ENV=production.',
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

  // Express 5 passes listen failures (e.g. port in use) to this callback.
  const server = app.listen(config.port, (error?: Error) => {
    if (error) {
      logger.fatal(
        { err: error },
        `Could not start the server: ${describeListenError(error as NodeJS.ErrnoException, config.port)}`,
      );
      process.exit(1);
    }
    const address = server.address();
    const port = typeof address === 'object' && address !== null ? address.port : config.port;
    logger.info(
      {
        port,
        quantityPrecision: config.order.quantityPrecision,
        defaultStockPrice: config.order.defaultStockPrice,
        authenticatedPartners: [...new Set(config.auth.apiKeys.map((k) => k.partnerId))],
        market: config.market,
      },
      `Order splitter API listening on http://localhost:${String(port)}`,
    );
  });

  // Slow-client protection (slowloris): headers must arrive within 20 s and the whole
  // request within 30 s (headersTimeout must not exceed requestTimeout to have any effect).
  server.headersTimeout = 20_000;
  server.requestTimeout = 30_000;
  // Keep idle connections open longer than a typical load balancer's idle timeout (60s),
  // otherwise the LB may reuse a socket Node has just closed and return a 502.
  server.keepAliveTimeout = 65_000;

  /**
   * Graceful shutdown: fail readiness so no new traffic arrives, stop accepting
   * connections, let in-flight requests finish, then exit. Force-exit after a grace period.
   */
  const shutdown = (reason: string, exitCode: 0 | 1, graceMs: number): void => {
    if (lifecycle.isDraining) return;
    lifecycle.startDraining();
    logger.info({ reason }, 'Shutting down: draining connections');

    server.close(() => {
      logger.info('HTTP server closed');
      process.exit(exitCode);
    });
    server.closeIdleConnections();
    setTimeout(() => {
      logger.warn('Grace period elapsed; forcing exit');
      process.exit(exitCode === 0 ? 1 : exitCode);
    }, graceMs).unref();
  };

  process.on('SIGTERM', () => {
    shutdown('SIGTERM', 0, SHUTDOWN_GRACE_MS);
  });
  process.on('SIGINT', () => {
    shutdown('SIGINT', 0, SHUTDOWN_GRACE_MS);
  });
  registerProcessHandlers(process, logger, (reason) => {
    if (lifecycle.isDraining) {
      // Already shutting down (e.g. a second fatal error): exit now.
      process.exit(1);
    }
    shutdown(reason, 1, FATAL_GRACE_MS);
  });
};

start();

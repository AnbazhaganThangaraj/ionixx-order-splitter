import 'dotenv/config';
import { createApp } from './app';
import { ConfigError, loadConfig } from './config/app.config';
import { createLogger } from './lib/logger';

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
  const app = createApp(config, { logger });

  const server = app.listen(config.port, () => {
    logger.info(
      {
        port: config.port,
        quantityPrecision: config.order.quantityPrecision,
        defaultStockPrice: config.order.defaultStockPrice,
        market: config.market,
      },
      `Order splitter API listening on http://localhost:${config.port}`,
    );
  });

  const shutdown = (signal: string): void => {
    logger.info({ signal }, 'Shutting down');
    server.close(() => process.exit(0));
    // Do not hang forever on keep-alive connections.
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => {
    shutdown('SIGTERM');
  });
  process.on('SIGINT', () => {
    shutdown('SIGINT');
  });
};

start();

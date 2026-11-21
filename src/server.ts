import 'dotenv/config';
import { createApp } from './app';
import { ConfigError, loadConfig } from './config/app.config';

const start = (): void => {
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }

  const app = createApp(config);
  const server = app.listen(config.port, () => {
    console.log(`Order splitter API listening on http://localhost:${config.port}`);
  });

  const shutdown = (signal: string): void => {
    console.log(`${signal} received, shutting down`);
    server.close(() => process.exit(0));
  };
  process.on('SIGTERM', () => {
    shutdown('SIGTERM');
  });
  process.on('SIGINT', () => {
    shutdown('SIGINT');
  });
};

start();

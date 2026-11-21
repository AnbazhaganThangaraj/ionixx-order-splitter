import express, { type Express } from 'express';
import type { AppConfig } from './config/app.config';
import { createHealthRouter } from './routes/health.routes';

/**
 * Builds the Express application without starting a listener, so integration
 * tests can drive it in-process with Supertest.
 */
export const createApp = (_config: AppConfig): Express => {
  const app = express();

  app.disable('x-powered-by');
  app.use(express.json({ limit: '100kb' }));

  app.use('/health', createHealthRouter());

  return app;
};

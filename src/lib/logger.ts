import pino, { type DestinationStream, type Logger } from 'pino';
import type { AppConfig } from '../config/app.config';

export type { Logger };

/**
 * Structured JSON logger. Request bodies are never logged (they describe a
 * user's investments); credentials are redacted defensively.
 */
export const createLogger = (
  level: AppConfig['logLevel'],
  destination?: DestinationStream,
): Logger =>
  pino(
    {
      level,
      base: { service: 'ionixx-order-splitter' },
      timestamp: pino.stdTimeFunctions.isoTime,
      // Defence in depth: nothing logs headers or secrets today, but if someone adds
      // e.g. logger.info({ req }) later, credentials are still masked.
      redact: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.headers["x-api-key"]',
        'headers["x-api-key"]',
        'apiKey',
        '*.apiKey',
      ],
    },
    destination,
  );

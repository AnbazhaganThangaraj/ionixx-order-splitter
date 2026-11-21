import pino, { type DestinationStream, type Logger } from 'pino';
import type { AppConfig } from '../config/app.config';

export type { Logger };

/**
 * Structured JSON logger. Request bodies are never logged (they describe a
 * user's investments); auth headers are redacted defensively for the future.
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
      redact: ['req.headers.authorization', 'req.headers.cookie'],
    },
    destination,
  );

import type { RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import { AppError } from '../errors/app-error';

export interface RateLimitOptions {
  readonly windowMs: number;
  readonly max: number;
}

/**
 * Fixed-window rate limit per client IP, applied BEFORE authentication so it also
 * slows down API-key guessing. Sends the standard RateLimit-* and Retry-After headers
 * and our usual error body (429 RATE_LIMITED).
 *
 * The counter store is in memory, i.e. per process. With several instances this
 * should move to a shared store (e.g. Redis) or to the API gateway.
 */
export const apiRateLimit = ({ windowMs, max }: RateLimitOptions): RequestHandler =>
  rateLimit({
    windowMs,
    limit: max,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_req, _res, next) => {
      next(
        new AppError(
          429,
          'RATE_LIMITED',
          'Too many requests; retry after the Retry-After interval',
        ),
      );
    },
  });

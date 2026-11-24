import type { RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import { AppError } from '../errors/app-error';
import type { AuditLog } from '../lib/audit';
import { getRequestId } from './request-id.middleware';

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
export const apiRateLimit = (
  { windowMs, max }: RateLimitOptions,
  audit: AuditLog,
): RequestHandler =>
  rateLimit({
    windowMs,
    limit: max,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (req, res, next) => {
      audit.record('rate_limit.exceeded', {
        requestId: getRequestId(res.locals),
        scope: 'ip',
        clientIp: req.ip,
      });
      next(
        new AppError(
          429,
          'RATE_LIMITED',
          'Too many requests; retry after the Retry-After interval',
        ),
      );
    },
  });

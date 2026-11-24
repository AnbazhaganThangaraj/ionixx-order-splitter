import type { RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import { AppError } from '../errors/app-error';
import type { AuditLog } from '../lib/audit';
import { getPartnerId } from './api-key-auth.middleware';
import { getRequestId } from './request-id.middleware';

export interface RateLimitOptions {
  readonly windowMs: number;
  readonly max: number;
  readonly partnerMax: number;
}

/**
 * Two fixed-window limits (in-memory, i.e. per process; use a shared store such as
 * Redis or the API gateway when running several instances):
 *
 * 1. apiRateLimit, per client IP, BEFORE authentication: protects against floods and
 *    slows down API-key guessing.
 * 2. partnerRateLimit, per partner, AFTER authentication: a fair-use quota per partner,
 *    independent of how many IPs the partner uses or how many partners share an IP.
 *
 * Both send IETF RateLimit / RateLimit-Policy headers, Retry-After, and the usual error body.
 */
export const apiRateLimit = (
  { windowMs, max }: RateLimitOptions,
  audit: AuditLog,
): RequestHandler =>
  rateLimit({
    windowMs,
    limit: max,
    identifier: 'ip',
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

export const partnerRateLimit = (
  { windowMs, partnerMax }: RateLimitOptions,
  audit: AuditLog,
): RequestHandler =>
  rateLimit({
    windowMs,
    limit: partnerMax,
    identifier: 'partner',
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: (_req, res) => getPartnerId(res.locals),
    handler: (req, res, next) => {
      audit.record('rate_limit.exceeded', {
        requestId: getRequestId(res.locals),
        scope: 'partner',
        partnerId: getPartnerId(res.locals),
        clientIp: req.ip,
      });
      next(
        new AppError(
          429,
          'PARTNER_QUOTA_EXCEEDED',
          'Partner request quota exceeded; retry after the Retry-After interval',
        ),
      );
    },
  });

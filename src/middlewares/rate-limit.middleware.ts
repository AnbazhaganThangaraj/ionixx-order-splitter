import type { Request, RequestHandler, Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import type { AppConfig } from '../config/app.config';
import { AppError } from '../errors/app-error';
import type { ErrorCode } from '../errors/error-codes';
import type { AuditLog } from '../lib/audit';
import { findPartnerId, getPartnerId, getRequestId } from '../lib/request-context';

export type RateLimitOptions = AppConfig['http']['rateLimit'];

/** express-rate-limit attaches its counters to the request as `req.rateLimit`. */
const retryAfterSeconds = (req: unknown, windowMs: number): number => {
  const info = (req as { rateLimit?: { resetTime?: Date } }).rateLimit;
  const resetAt = info?.resetTime?.getTime();
  const ms = resetAt === undefined ? windowMs : resetAt - Date.now();
  return Math.max(1, Math.ceil(ms / 1000));
};

const windowText = (windowMs: number): string =>
  windowMs % 60_000 === 0 ? `${windowMs / 60_000} min` : `${Math.round(windowMs / 1000)} s`;

interface LimiterSpec {
  /** Policy name in the RateLimit headers and the audit event's `scope`. */
  readonly scope: 'ip' | 'partner';
  readonly limit: number;
  readonly windowMs: number;
  readonly errorCode: ErrorCode;
  /** Start of the error message, e.g. "Too many requests from this IP address". */
  readonly describe: string;
  /** Counter key; express-rate-limit's IP key (IPv6-safe) when omitted. */
  readonly keyGenerator?: (req: Request, res: Response) => string;
}

/**
 * One fixed-window limiter: IETF RateLimit / RateLimit-Policy headers, Retry-After, an
 * audit event and the usual error body. Counters are in memory, i.e. per process; use a
 * shared store (e.g. Redis) or the API gateway when running several instances.
 */
const createRateLimiter = (spec: LimiterSpec, audit: AuditLog): RequestHandler =>
  rateLimit({
    windowMs: spec.windowMs,
    limit: spec.limit,
    identifier: spec.scope,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    ...(spec.keyGenerator === undefined ? {} : { keyGenerator: spec.keyGenerator }),
    handler: (req, res, next) => {
      const partnerId = findPartnerId(res.locals);
      audit.record('rate_limit.exceeded', {
        requestId: getRequestId(res.locals),
        scope: spec.scope,
        clientIp: req.ip,
        ...(partnerId === undefined ? {} : { partnerId }),
      });
      next(
        new AppError(
          429,
          spec.errorCode,
          `${spec.describe} (limit ${spec.limit} per ${windowText(spec.windowMs)}); ` +
            `retry in ${retryAfterSeconds(req, spec.windowMs)} s`,
        ),
      );
    },
  });

/**
 * Per client IP, BEFORE authentication: protects against floods and slows down API-key
 * guessing.
 */
export const apiRateLimit = (
  { windowMs, max }: RateLimitOptions,
  audit: AuditLog,
): RequestHandler =>
  createRateLimiter(
    {
      scope: 'ip',
      limit: max,
      windowMs,
      errorCode: 'RATE_LIMITED',
      describe: 'Too many requests from this IP address',
    },
    audit,
  );

/**
 * Per partner, AFTER authentication: a fair-use quota per partner, independent of how
 * many IPs the partner uses or how many partners share an IP.
 */
export const partnerRateLimit = (
  { windowMs, partnerMax }: RateLimitOptions,
  audit: AuditLog,
): RequestHandler =>
  createRateLimiter(
    {
      scope: 'partner',
      limit: partnerMax,
      windowMs,
      errorCode: 'PARTNER_QUOTA_EXCEEDED',
      describe: 'Partner request quota exceeded',
      keyGenerator: (_req, res) => getPartnerId(res.locals),
    },
    audit,
  );

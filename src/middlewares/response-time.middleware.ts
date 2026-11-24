import { performance } from 'node:perf_hooks';
import type { Request, RequestHandler } from 'express';
import type { Logger } from '../lib/logger';
import { getRequestId } from './request-id.middleware';

/**
 * Express resets req.baseUrl when a request leaves a router (e.g. an error is
 * passed on to the error handler), so remember the mount path while it is known.
 */
export const recordMountPath = (): RequestHandler => (req, res, next) => {
  res.locals.mountPath = req.baseUrl;
  next();
};

/** Route template (e.g. /api/v1/orders/:orderId) groups requests for metrics; falls back to the path. */
const routeOf = (req: Request, locals: Record<string, unknown>): string => {
  const route: unknown = req.route;
  if (
    route !== null &&
    typeof route === 'object' &&
    'path' in route &&
    typeof route.path === 'string'
  ) {
    const mountPath = typeof locals.mountPath === 'string' ? locals.mountPath : req.baseUrl;
    const routePath = route.path === '/' ? '' : route.path;
    return `${mountPath}${routePath}` || '/';
  }
  return req.path;
};

/**
 * Instruments every response time in milliseconds using a monotonic clock
 * (performance.now is not affected by system clock changes) and logs one
 * structured line per request. Bodies and query values are not logged.
 */
export const responseTimeLogger =
  (logger: Logger): RequestHandler =>
  (req, res, next) => {
    const start = performance.now();

    res.on('finish', () => {
      const durationMs = Math.round((performance.now() - start) * 100) / 100;
      const entry = {
        requestId: getRequestId(res.locals),
        method: req.method,
        route: routeOf(req, res.locals),
        statusCode: res.statusCode,
        durationMs,
        clientIp: req.ip,
      };
      const message = `${req.method} ${entry.route} ${res.statusCode} ${durationMs}ms`;

      if (res.statusCode >= 500) logger.error(entry, message);
      else if (res.statusCode >= 400) logger.warn(entry, message);
      else logger.info(entry, message);
    });

    next();
  };

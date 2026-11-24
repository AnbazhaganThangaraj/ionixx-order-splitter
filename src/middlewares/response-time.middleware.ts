import { findPartnerId, getRequestId } from '../lib/request-context';
import { performance } from 'node:perf_hooks';
import type { Request, RequestHandler } from 'express';
import { truncate } from '../errors/app-error';
import type { Logger } from '../lib/logger';

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
  // No named route (unmatched paths, static Swagger UI files): log the full original
  // path, without the query string, truncated so log labels cannot grow without limit.
  // (req.path is relative to the current router, e.g. "/" inside /docs.)
  return truncate(req.originalUrl.split('?')[0] ?? req.path, 100);
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

    let logged = false;
    const log = (): void => {
      if (logged) return;
      logged = true;
      const durationMs = Math.round((performance.now() - start) * 100) / 100;
      // A connection closed before the response finished is logged as 499 (client closed).
      const aborted = !res.writableFinished;
      const statusCode = aborted ? 499 : res.statusCode;
      const entry = {
        requestId: getRequestId(res.locals),
        method: req.method,
        route: routeOf(req, res.locals),
        statusCode,
        durationMs,
        clientIp: req.ip,
        partnerId: findPartnerId(res.locals),
        ...(aborted ? { aborted: true } : {}),
      };
      const message = `${req.method} ${entry.route} ${statusCode} ${durationMs}ms${aborted ? ' (client closed)' : ''}`;

      if (statusCode >= 500) logger.error(entry, message);
      else if (statusCode >= 400) logger.warn(entry, message);
      else logger.info(entry, message);
    };
    res.on('finish', log);
    res.on('close', log);

    next();
  };

import type { RequestHandler } from 'express';
import { AppError } from '../errors/app-error';

/**
 * Mounted with router.all() after a path's real handlers: a known path called with an
 * unsupported method gets 405 + Allow (RFC 9110) instead of a misleading 404.
 * OPTIONS is answered with 204 + Allow (no CORS: this API is server-to-server).
 */
const routePath = (baseUrl: string, path: string): string =>
  `${baseUrl}${path === '/' ? '' : path}` || '/';

export const methodNotAllowed = (allowed: readonly string[]): RequestHandler => {
  const methods = allowed.includes('GET') ? [...allowed, 'HEAD'] : [...allowed];
  const allowHeader = [...methods, 'OPTIONS'].join(', ');

  return (req, res, next) => {
    res.setHeader('Allow', allowHeader);
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next(
      new AppError(
        405,
        'METHOD_NOT_ALLOWED',
        `Method ${req.method} is not allowed on ${routePath(req.baseUrl, req.path)}; allowed: ${allowHeader}`,
      ),
    );
  };
};

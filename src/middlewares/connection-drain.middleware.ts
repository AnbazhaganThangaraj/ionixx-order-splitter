import type { RequestHandler } from 'express';
import type { AppLifecycle } from '../lib/lifecycle';

/** While shutting down, ask clients not to reuse the connection for further requests. */
export const connectionDrain =
  (lifecycle: AppLifecycle): RequestHandler =>
  (_req, res, next) => {
    if (lifecycle.isDraining) res.setHeader('Connection', 'close');
    next();
  };

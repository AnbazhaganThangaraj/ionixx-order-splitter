import { type RequestHandler, Router } from 'express';
import type { Clock } from '../lib/clock';
import type { AppLifecycle } from '../lib/lifecycle';
import { methodNotAllowed } from '../middlewares/method-not-allowed.middleware';

/**
 * - GET /health/live  liveness: the process is up (restart it if this fails)
 * - GET /health/ready readiness: OK to receive traffic (503 while shutting down)
 * - GET /health       alias of liveness, kept for simple checks
 */
export const createHealthRouter = (lifecycle: AppLifecycle, clock: Clock): Router => {
  const router = Router();

  const live = (): Record<string, unknown> => ({
    status: 'ok',
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: clock.now().toISOString(),
  });

  // One handler, two paths. Registered separately (not as an array) so the access log
  // keeps a plain route template for each path.
  const liveHandler: RequestHandler = (_req, res) => {
    res.status(200).json(live());
  };
  router.get('/', liveHandler);
  router.get('/live', liveHandler);
  router.get('/ready', (_req, res) => {
    if (lifecycle.isDraining) {
      res.status(503).json({ status: 'draining', timestamp: clock.now().toISOString() });
      return;
    }
    res.status(200).json({ status: 'ready', timestamp: clock.now().toISOString() });
  });

  for (const path of ['/', '/live', '/ready']) {
    router.all(path, methodNotAllowed(['GET']));
  }

  return router;
};

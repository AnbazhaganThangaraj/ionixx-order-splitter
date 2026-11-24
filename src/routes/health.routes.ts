import { Router } from 'express';
import type { AppLifecycle } from '../lib/lifecycle';

/**
 * - GET /health/live  liveness: the process is up (restart it if this fails)
 * - GET /health/ready readiness: OK to receive traffic (503 while shutting down)
 * - GET /health       alias of liveness, kept for simple checks
 */
export const createHealthRouter = (lifecycle: AppLifecycle): Router => {
  const router = Router();

  const live = (): Record<string, unknown> => ({
    status: 'ok',
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  });

  router.get('/', (_req, res) => {
    res.status(200).json(live());
  });
  router.get('/live', (_req, res) => {
    res.status(200).json(live());
  });
  router.get('/ready', (_req, res) => {
    if (lifecycle.isDraining) {
      res.status(503).json({ status: 'draining', timestamp: new Date().toISOString() });
      return;
    }
    res.status(200).json({ status: 'ready', timestamp: new Date().toISOString() });
  });

  return router;
};

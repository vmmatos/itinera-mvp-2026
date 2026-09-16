import { Router } from 'express';
import type { Response } from 'express';
import type { HealthResponse, ReadyResponse } from '../types/api';

/**
 * `/health` (always ok — process is up) + `/ready` (200/503 gated on every
 * named check). Each service passes its own dependency probes, e.g.:
 *
 *   createHealthRouter('validator', { db: () => AppDataSource.isInitialized,
 *                                      rabbitmq: () => publisher.isConnected() })
 */
export function createHealthRouter(
  serviceName: string,
  checks: Record<string, () => boolean>,
): Router {
  const router = Router();

  router.get('/health', (_req, res: Response<HealthResponse>) => {
    res.json({ status: 'ok', service: serviceName, timestamp: new Date().toISOString() });
  });

  router.get('/ready', (_req, res: Response<ReadyResponse>) => {
    const results = Object.fromEntries(
      Object.entries(checks).map(([name, check]) => [name, check()]),
    );
    const ready = Object.values(results).every(Boolean);

    res.status(ready ? 200 : 503).json({
      status: ready ? 'ready' : 'not_ready',
      service: serviceName,
      timestamp: new Date().toISOString(),
      checks: results,
    });
  });

  return router;
}

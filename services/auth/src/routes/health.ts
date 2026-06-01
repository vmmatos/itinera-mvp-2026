import { Router } from 'express';
import type { Response } from 'express';
import type { HealthResponse, ReadyResponse } from '@itinera/shared';
import { AppDataSource } from '@/data-source';

export function createHealthRouter(): Router {
  const router = Router();

  router.get('/health', (_req, res: Response<HealthResponse>) => {
    res.json({ status: 'ok', service: 'auth', timestamp: new Date().toISOString() });
  });

  router.get('/ready', (_req, res: Response<ReadyResponse>) => {
    const db = AppDataSource.isInitialized;
    res.status(db ? 200 : 503).json({
      status: db ? 'ready' : 'not_ready',
      service: 'auth',
      timestamp: new Date().toISOString(),
      checks: { db },
    });
  });

  return router;
}

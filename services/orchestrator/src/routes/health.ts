import { Router } from 'express';
import type { Response } from 'express';
import type { HealthResponse, ReadyResponse } from '@itinera/shared';
import { AppDataSource } from '@/data-source';
import type { EventPublisher } from '@/services/EventPublisher';

export function createHealthRouter(eventPublisher: EventPublisher): Router {
  const router = Router();

  router.get('/health', (_req, res: Response<HealthResponse>) => {
    res.json({ status: 'ok', service: 'orchestrator', timestamp: new Date().toISOString() });
  });

  router.get('/ready', (_req, res: Response<ReadyResponse>) => {
    const db = AppDataSource.isInitialized;
    const mq = eventPublisher.isConnected();
    const ready = db && mq;
    
    res.status(ready ? 200 : 503).json({
      status: ready ? 'ready' : 'not_ready',
      service: 'orchestrator',
      timestamp: new Date().toISOString(),
      checks: { db, mq },
    });
  });

  return router;
}

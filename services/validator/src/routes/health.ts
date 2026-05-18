import { Router } from 'express';
import type { Response } from 'express';
import type { HealthResponse, ReadyResponse } from '@itinera/shared';
import { AppDataSource } from '@/data-source';
import type { RabbitMQPublisher } from '@/services/RabbitMQPublisher';

export function createHealthRouter(publisher: RabbitMQPublisher): Router {
  const router = Router();

  router.get('/health', (_req, res: Response<HealthResponse>) => {
    res.json({
      status: 'ok',
      service: 'validator',
      timestamp: new Date().toISOString(),
    });
  });

  router.get('/ready', (_req, res: Response<ReadyResponse>) => {
    const db = AppDataSource.isInitialized;
    const mq = publisher.isConnected();
    const ready = db && mq;

    res.status(ready ? 200 : 503).json({
      status: ready ? 'ready' : 'not_ready',
      service: 'validator',
      timestamp: new Date().toISOString(),
      checks: { db, rabbitmq: mq },
    });
  });

  return router;
}

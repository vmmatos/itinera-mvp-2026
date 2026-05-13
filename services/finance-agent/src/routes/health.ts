import { Router } from 'express';
import type { Response } from 'express';
import type { HealthResponse, ReadyResponse } from '@itinera/shared';
import { AppDataSource } from '@/data-source';
import type { RabbitMQPublisher } from '@/services/RabbitMQPublisher';
import type { RedisService } from '@/services/RedisService';

export function createHealthRouter(
  publisher: RabbitMQPublisher,
  redis: RedisService,
): Router {
  const router = Router();

  router.get('/health', (_req, res: Response<HealthResponse>) => {
    res.json({
      status: 'ok',
      service: 'finance-agent',
      timestamp: new Date().toISOString(),
    });
  });

  router.get('/ready', (_req, res: Response<ReadyResponse>) => {
    const db = AppDataSource.isInitialized;
    const mq = publisher.isConnected();
    const cache = redis.isConnected();
    const ready = db && mq && cache;

    res.status(ready ? 200 : 503).json({
      status: ready ? 'ready' : 'not_ready',
      service: 'finance-agent',
      timestamp: new Date().toISOString(),
      checks: { db, rabbitmq: mq, redis: cache },
    });
  });

  return router;
}

import { createHealthRouter as createRouter } from '@itinera/shared';
import type { Router } from 'express';
import { AppDataSource } from '@/data-source';
import type { RabbitMQPublisher } from '@/services/RabbitMQPublisher';
import type { RedisService } from '@/services/RedisService';

export function createHealthRouter(
  publisher: RabbitMQPublisher,
  redis: RedisService,
): Router {
  return createRouter('finance-agent', {
    db: () => AppDataSource.isInitialized,
    rabbitmq: () => publisher.isConnected(),
    redis: () => redis.isConnected(),
  });
}

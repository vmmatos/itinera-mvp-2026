import { createHealthRouter as createRouter } from '@itinera/shared';
import type { Router } from 'express';
import type { RabbitMQPublisher } from '@/services/RabbitMQPublisher';
import type { RedisService } from '@/services/RedisService';

export function createHealthRouter(
  publisher: RabbitMQPublisher,
  redis: RedisService,
): Router {
  return createRouter('orchestrator-agent', {
    rabbitmq: () => publisher.isConnected(),
    redis: () => redis.isConnected(),
  });
}

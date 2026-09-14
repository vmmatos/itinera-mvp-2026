import { createHealthRouter as createRouter } from '@itinera/shared';
import type { Router } from 'express';
import { AppDataSource } from '@/data-source';
import type { RabbitMQPublisher } from '@/services/RabbitMQPublisher';

export function createHealthRouter(publisher: RabbitMQPublisher): Router {
  return createRouter('validator', {
    db: () => AppDataSource.isInitialized,
    rabbitmq: () => publisher.isConnected(),
  });
}

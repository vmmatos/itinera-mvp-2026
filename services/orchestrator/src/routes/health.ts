import { createHealthRouter as createRouter } from '@itinera/shared';
import type { Router } from 'express';
import { AppDataSource } from '@/data-source';
import type { EventPublisher } from '@/services/EventPublisher';

export function createHealthRouter(eventPublisher: EventPublisher): Router {
  return createRouter('orchestrator', {
    db: () => AppDataSource.isInitialized,
    mq: () => eventPublisher.isConnected(),
  });
}

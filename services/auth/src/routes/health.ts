import { createHealthRouter as createRouter } from '@itinera/shared';
import type { Router } from 'express';
import { AppDataSource } from '@/data-source';

export function createHealthRouter(): Router {
  return createRouter('auth', {
    db: () => AppDataSource.isInitialized,
  });
}

import type { Express } from 'express';
import type Redis from 'ioredis';
import { errorHandler } from '@itinera/shared';
import { createHealthRouter } from '@/routes/health';
import { createAuthRouter } from '@/routes/auth';
import type { AuthService } from '@/services/AuthService';

export function registerRoutes(app: Express, authService: AuthService, redis: Redis): void {
  app.use(createHealthRouter());
  app.use(createAuthRouter(authService, redis));
  app.use(errorHandler);
}

import type { Express } from 'express';
import { authMiddleware } from '@itinera/shared';
import { createHealthRouter } from '@/routes/health';
import { createTripsRouter } from '@/routes/trips';
import { TripController } from '@/controllers/TripController';
import type { EventPublisher } from '@/services/EventPublisher';
import type { TripService } from '@/services/TripService';

export function registerRoutes(
  app: Express,
  eventPublisher: EventPublisher,
  tripService: TripService,
): void {
  app.use(createHealthRouter(eventPublisher));
  app.use(authMiddleware);
  app.use('/api/v1/trips', createTripsRouter(new TripController(tripService)));
}

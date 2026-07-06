import { Router } from 'express';
import { TripController } from '@/controllers/TripController';

export function createTripsRouter(controller: TripController): Router {
  const router = Router();

  router.get('/', controller.listTrips);
  router.post('/', controller.createTrip);
  router.post('/preview-destinations', controller.previewDestinations);
  router.get('/:id/proposals', controller.getTripProposals);
  router.patch('/:id/status', controller.updateTripStatus);
  router.get('/:id', controller.getTrip);

  return router;
}

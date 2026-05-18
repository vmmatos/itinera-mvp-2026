import type { Request, Response, NextFunction } from 'express';
import type { AuthenticatedRequest } from '@itinera/shared';
import { ok } from '@itinera/shared';
import { TripService } from '@/services/TripService';
import { CreateTripSchema, TripIdParamSchema } from '@/validation/trip.schemas';

export class TripController {
  constructor(private readonly tripService: TripService) {}

  createTrip = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const authedReq = req as AuthenticatedRequest;
      const input = CreateTripSchema.parse(req.body);
      const trip = await this.tripService.createTrip(authedReq.user.sub, input);
      this.tripService.startOrchestration(trip.id);
      res.status(202).json(ok(trip));
    } catch (err) {
      next(err);
    }
  };

  getTrip = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const authedReq = req as AuthenticatedRequest;
      const { id } = TripIdParamSchema.parse(req.params);
      const isAdmin = authedReq.user.role === 'admin' && req.query['view'] === 'debug';
      const trip = await this.tripService.getTrip(id, isAdmin);
      res.json(ok(trip));
    } catch (err) {
      next(err);
    }
  };
}

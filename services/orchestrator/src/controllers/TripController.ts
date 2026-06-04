import type { Request, Response, NextFunction } from 'express';
import type { AuthenticatedRequest } from '@itinera/shared';
import { ok, NotFoundError } from '@itinera/shared';
import { TripService } from '@/services/TripService';
import { CreateTripSchema, TripIdParamSchema, UpdateTripStatusSchema } from '@/validation/trip.schemas';

export class TripController {
  constructor(private readonly tripService: TripService) {}

  listTrips = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const authedReq = req as AuthenticatedRequest;
      const trips = await this.tripService.listTrips(authedReq.user.sub);
      res.json(ok(trips));
    } catch (err) {
      next(err);
    }
  };

  createTrip = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const authedReq = req as AuthenticatedRequest;
      const input = CreateTripSchema.parse(req.body);
      const trip = await this.tripService.createTrip(authedReq.user.sub, input);
      this.tripService.startOrchestration(trip.id);
      res.status(202).json(ok({ tripId: trip.id, status: trip.status, message: 'Trip created' }));
    } catch (err) {
      next(err);
    }
  };

  getTripProposals = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const authedReq = req as AuthenticatedRequest;
      const { id } = TripIdParamSchema.parse(req.params);
      const trip = await this.tripService.getTrip(id, false);
      if ('ownerId' in trip && trip.ownerId !== authedReq.user.sub && authedReq.user.role !== 'admin') {
        throw new NotFoundError(`Trip ${id}`);
      }
      const proposals = await this.tripService.getTripProposals(id);
      res.json(ok(proposals));
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

  updateTripStatus = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const authedReq = req as AuthenticatedRequest;
      const { id } = TripIdParamSchema.parse(req.params);
      const { status } = UpdateTripStatusSchema.parse(req.body);
      await this.tripService.updateTripStatus(id, authedReq.user.sub, status);
      res.json(ok({ tripId: id, status }));
    } catch (err) {
      next(err);
    }
  };
}

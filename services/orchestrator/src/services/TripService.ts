import { BaseService, NotFoundError } from '@itinera/shared';
import type { TripStatus } from '@itinera/shared';
import { AppDataSource } from '@/data-source';
import { Trip } from '@/entities/Trip';
import { Traveller } from '@/entities/Traveller';
import { Proposal } from '@/entities/Proposal';
import { AgentLog } from '@/entities/AgentLog';
import { TripMetric } from '@/entities/TripMetric';
import { StateManager } from '@/services/StateManager';
import { NegotiationLoop } from '@/services/NegotiationLoop';
import type { CreateTripInput } from '@/validation/trip.schemas';

export interface TripSummary {
  id: string;
  name: string;
  status: TripStatus;
  region: string | null;
  destinations: Array<{ country: string; city?: string; nights: number }>;
  ownerId: string;
  startDate: Date | null;
  endDate: Date | null;
  budgetTotal: number | null;
  budgetCurrency: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface TripDebugView extends TripSummary {
  proposals: Proposal[];
  agentLogs: AgentLog[];
  metrics: TripMetric[];
}

export class TripService extends BaseService {
  constructor(
    private readonly stateManager: StateManager,
    private readonly negotiationLoop: NegotiationLoop,
  ) {
    super('trip-service');
  }

  async createTrip(ownerId: string, input: CreateTripInput): Promise<TripSummary> {
    const tripRepo = AppDataSource.getRepository(Trip);
    const travellerRepo = AppDataSource.getRepository(Traveller);

    const trip = await AppDataSource.transaction(async (manager) => {
      const destinations = input.destinations ?? [];
      const totalNights = destinations.reduce((s, d) => s + d.nights, 0);
      const endDate = input.endDate
        ?? (input.startDate && totalNights > 0
          ? new Date(new Date(input.startDate).getTime() + totalNights * 86_400_000).toISOString().slice(0, 10)
          : undefined);

      const newTrip = tripRepo.create({
        name: input.name,
        region: input.region ?? null,
        destinations,
        ownerId,
        startDate: input.startDate ? new Date(input.startDate) : null,
        endDate: endDate ? new Date(endDate) : null,
        budgetTotal: input.budgetTotal ?? null,
        budgetCurrency: input.budgetCurrency ?? 'EUR',
        status: 'draft',
      });
      const savedTrip = await manager.save(newTrip);

      if (input.travellers?.length) {
        const travellers = input.travellers.map((t) =>
          travellerRepo.create({
            tripId: savedTrip.id,
            userId: t.userId ?? null,
            preferences: t.preferences ?? {},
          }),
        );
        await manager.save(travellers);
      }

      return savedTrip;
    });

    this.logger.info('Trip created', { tripId: trip.id, ownerId });
    return this.toSummary(trip);
  }

  async getTripProposals(tripId: string): Promise<Proposal[]> {
    return AppDataSource.getRepository(Proposal).find({
      where: { tripId },
      order: { createdAt: 'ASC' },
    });
  }

  startOrchestration(tripId: string): void {
    this.negotiationLoop.run(tripId).catch((err: unknown) => {
      this.logger.error('Orchestration failed', { tripId, error: String(err) });
    });
  }

  async updateTripStatus(tripId: string, ownerId: string, status: TripStatus): Promise<TripSummary> {
    const repo = AppDataSource.getRepository(Trip);
    const trip = await repo.findOne({ where: { id: tripId, ownerId } });
    if (!trip) throw new NotFoundError(`Trip ${tripId}`);
    await this.stateManager.transitionStatus(tripId, status);
    trip.status = status;
    return this.toSummary(trip);
  }

  async listTrips(ownerId: string, isAdmin = false): Promise<TripSummary[]> {
    const trips = await AppDataSource.getRepository(Trip).find({
      where: isAdmin ? undefined : { ownerId },
      order: { createdAt: 'DESC' },
    });
    return trips.map((t) => this.toSummary(t));
  }

  async getTrip(tripId: string, isAdmin: boolean): Promise<TripSummary | TripDebugView> {
    const trip = await AppDataSource.getRepository(Trip).findOne({ where: { id: tripId } });
    if (!trip) throw new NotFoundError(`Trip ${tripId}`);

    if (!isAdmin) return this.toSummary(trip);

    const [proposals, agentLogs, metrics] = await Promise.all([
      AppDataSource.getRepository(Proposal).find({ where: { tripId } }),
      AppDataSource.getRepository(AgentLog).find({ where: { tripId } }),
      AppDataSource.getRepository(TripMetric).find({ where: { tripId } }),
    ]);

    return { ...this.toSummary(trip), proposals, agentLogs, metrics };
  }

  private toSummary(trip: Trip): TripSummary {
    return {
      id: trip.id,
      name: trip.name,
      status: trip.status as TripStatus,
      region: trip.region,
      destinations: trip.destinations ?? [],
      ownerId: trip.ownerId,
      startDate: trip.startDate,
      endDate: trip.endDate,
      budgetTotal: trip.budgetTotal,
      budgetCurrency: trip.budgetCurrency,
      createdAt: trip.createdAt,
      updatedAt: trip.updatedAt,
    };
  }
}

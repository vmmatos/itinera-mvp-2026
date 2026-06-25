import { BaseService, NotFoundError } from '@itinera/shared';
import type { TripStatus, DateInput } from '@itinera/shared';
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
  ownerName?: string;
  ownerEmail?: string;
  startDate: Date | null;
  endDate: Date | null;
  budgetTotal: number | null;
  budgetCurrency: string;
  dateInput: DateInput | null;
  createdAt: Date;
  updatedAt: Date;
}

interface ProposalRoundDto {
  id: string;
  round: number;
  agent: string;
  action: string;
  content: unknown;
  reasoning?: string;
  createdAt: string;
}

interface AgentLogEntryDto {
  id: string;
  agent: string;
  round: number;
  action: string;
  latencyMs: number;
  tokensUsed: number;
  reasoning?: string;
  createdAt: string;
}

interface TripMetricsDto {
  convergenceRounds: number;
  fairnessScore: number;
  autonomyScore: number;
  totalTimeMs: number;
  totalTokensUsed: number;
}

export interface TripDebugView extends TripSummary {
  proposals: ProposalRoundDto[];
  agentLogs: AgentLogEntryDto[];
  metrics: TripMetricsDto[];
  scores: never[];
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
        dateInput: input.dateInput ?? null,
        transportPreference: input.transportPreference ?? 'best',
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

  async resolveFlexibleDates(tripId: string, startDate: string, endDate: string): Promise<void> {
    await AppDataSource.getRepository(Trip).update(
      { id: tripId },
      { startDate: new Date(startDate), endDate: new Date(endDate) },
    );
    this.logger.info('Flexible dates resolved', { tripId, startDate, endDate });
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
    const repo = AppDataSource.getRepository(Trip);
    const trips = isAdmin
      ? await repo.find({ relations: { owner: true }, order: { createdAt: 'DESC' } })
      : await repo.find({ where: { ownerId }, order: { createdAt: 'DESC' } });
    return trips.map((t) => this.toSummary(t));
  }

  async getTrip(tripId: string, isAdmin: boolean): Promise<TripSummary | TripDebugView> {
    const trip = await AppDataSource.getRepository(Trip).findOne({ where: { id: tripId } });
    if (!trip) throw new NotFoundError(`Trip ${tripId}`);

    if (!isAdmin) return this.toSummary(trip);

    const [rawProposals, rawLogs, rawMetrics] = await Promise.all([
      AppDataSource.getRepository(Proposal).find({ where: { tripId }, order: { createdAt: 'ASC' } }),
      AppDataSource.getRepository(AgentLog).find({ where: { tripId }, order: { createdAt: 'ASC' } }),
      AppDataSource.getRepository(TripMetric).find({ where: { tripId }, order: { round: 'ASC' } }),
    ]);

    return { ...this.toSummary(trip), ...this.toDebugView(rawProposals, rawLogs, rawMetrics) };
  }

  private toSummary(trip: Trip): TripSummary {
    return {
      id: trip.id,
      name: trip.name,
      status: trip.status as TripStatus,
      region: trip.region,
      destinations: trip.destinations ?? [],
      ownerId: trip.ownerId,
      ownerName: trip.owner?.name,
      ownerEmail: trip.owner?.email,
      startDate: trip.startDate,
      endDate: trip.endDate,
      budgetTotal: trip.budgetTotal,
      budgetCurrency: trip.budgetCurrency,
      dateInput: trip.dateInput ?? null,
      createdAt: trip.createdAt,
      updatedAt: trip.updatedAt,
    };
  }

  private toDebugView(
    rawProposals: Proposal[],
    rawLogs: AgentLog[],
    rawMetrics: TripMetric[],
  ): Pick<TripDebugView, 'proposals' | 'agentLogs' | 'metrics' | 'scores'> {
    const toIso = (d: Date | string): string =>
      d instanceof Date ? d.toISOString() : String(d);

    const logMap = new Map<string, AgentLog>();
    for (const l of rawLogs) logMap.set(`${l.agent}:${l.round}`, l);

    const proposals: ProposalRoundDto[] = rawProposals.map((p) => {
      const log = logMap.get(`${p.agent}:${p.round}`);
      return {
        id: p.id,
        round: p.round,
        agent: p.agent,
        action: log?.action ?? p.status,
        content: p.content,
        reasoning: log?.reasoning ?? undefined,
        createdAt: toIso(p.createdAt),
      };
    });

    const agentLogs: AgentLogEntryDto[] = rawLogs.map((l) => ({
      id: l.id,
      agent: l.agent,
      round: l.round,
      action: l.action,
      latencyMs: l.latencyMs ?? 0,
      tokensUsed: l.tokensUsed ?? 0,
      reasoning: l.reasoning ?? undefined,
      createdAt: toIso(l.createdAt),
    }));

    const validatorProposal = rawProposals.find((p) => p.agent === 'validator');
    const vc = validatorProposal?.content as Record<string, unknown> | undefined;
    const vFairness = vc?.['fairness'] as Record<string, unknown> | undefined;
    const vMetrics = vc?.['metrics'] as Record<string, unknown> | undefined;

    const fairnessScore =
      typeof vFairness?.['fairnessScore'] === 'number' ? vFairness['fairnessScore'] / 100 : 0;
    const autonomyScore =
      typeof vMetrics?.['autonomyPct'] === 'number' ? vMetrics['autonomyPct'] / 100 : 0;
    const convergenceRounds =
      typeof vMetrics?.['convergenceRounds'] === 'number'
        ? vMetrics['convergenceRounds']
        : rawMetrics.length;

    const totalTokensUsed = rawLogs.reduce((s, l) => s + (l.tokensUsed ?? 0), 0);
    const times = rawLogs.map((l) => new Date(l.createdAt).getTime());
    const totalTimeMs =
      times.length > 1 ? Math.max(...times) - Math.min(...times) : 0;

    return {
      proposals,
      agentLogs,
      metrics: [{ convergenceRounds, fairnessScore, autonomyScore, totalTimeMs, totalTokensUsed }],
      scores: [],
    };
  }
}

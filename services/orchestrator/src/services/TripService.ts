import { BaseService, NotFoundError, TooManyTripsError } from '@itinera/shared';
import type { TripStatus, DateInput, UserRole } from '@itinera/shared';
import { Not } from 'typeorm';
import { AppDataSource } from '@/data-source';
import { Trip } from '@/entities/Trip';
import { Traveller } from '@/entities/Traveller';
import { Proposal } from '@/entities/Proposal';
import { AgentLog } from '@/entities/AgentLog';
import { TripMetric } from '@/entities/TripMetric';
import { StateManager } from '@/services/StateManager';
import type { IOrchestrationEngine } from '@/services/WorkflowEngine';
import { DestinationParser } from '@/services/DestinationParser';
import type { CreateTripInput } from '@/validation/trip.schemas';
import { config } from '@/config';

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
  rejectionReason: string | null;
  workflowState: string | null;
  /** Present when a best-effort itinerary shipped above budget — drives the UI warning. */
  overBudget: { amountTotal: number; pct: number } | null;
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
  fairnessScore: number;
  autonomyScore: number;
  totalTimeMs: number;
  totalTokensUsed: number;
  financeBlockCount: number;
  logisticsBlockCount: number;
}

export interface CommitEntryDto {
  id: string;
  agent: string;
  round: number;
  action: 'accepted' | 'merged' | 'rejected' | 'accept' | 'reject';
  activity?: string;
  city?: string;
  reason?: string;
  createdAt: string;
}

// Proposal win-rate proxy per persona agent (share of that agent's proposals
// accepted/merged into the final itinerary) — not a real traveller
// satisfaction survey, which this codebase has no instrumentation for.
export interface AgentWinRateDto {
  agent: string;
  winRate: number;
}

export interface TripDebugView extends TripSummary {
  proposals: ProposalRoundDto[];
  agentLogs: AgentLogEntryDto[];
  metrics: TripMetricsDto[];
  scores: AgentWinRateDto[];
  commits: CommitEntryDto[];
}

export class TripService extends BaseService {
  private readonly destinationParser: DestinationParser;

  constructor(
    private readonly stateManager: StateManager,
    private readonly engine: IOrchestrationEngine,
    destinationParser?: DestinationParser,
  ) {
    super('trip-service');
    this.destinationParser = destinationParser ?? new DestinationParser();
  }

  async createTrip(ownerId: string, input: CreateTripInput, role?: UserRole): Promise<TripSummary> {
    const tripRepo = AppDataSource.getRepository(Trip);
    const travellerRepo = AppDataSource.getRepository(Traveller);

    if (role !== 'admin') {
      const activeCount = await tripRepo.count({ where: { ownerId, status: Not('cancelled') } });
      if (activeCount >= config.MAX_TRIPS_PER_USER) {
        throw new TooManyTripsError(config.MAX_TRIPS_PER_USER);
      }
    }

    // Structured destinations drive nights-per-city enforcement. When the form
    // only sends a free-text region, parse it so every leg (incl. the last city)
    // is captured instead of being silently improvised by the AI.
    let destinationsInput = input.destinations ?? [];
    if (destinationsInput.length === 0 && input.region) {
      const requestedNights = this.requestedNights(input);
      if (requestedNights > 0) {
        destinationsInput = await this.destinationParser.parse(input.region, requestedNights);
        this.logger.info('Parsed destinations from region', {
          region: input.region,
          destinations: destinationsInput.map((d) => `${d.city}/${d.country}·${d.nights}n`).join(', '),
        });
      }
    }

    const trip = await AppDataSource.transaction(async (manager) => {
      const destinations = destinationsInput;
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
        preferences: input.preferences ?? {},
        status: 'draft',
      });
      const savedTrip = await manager.save(newTrip);

      if (input.travellers?.length) {
        const travellers = input.travellers.map((t) =>
          travellerRepo.create({
            tripId: savedTrip.id,
            userId: t.userId ?? null,
            name: t.name ?? null,
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

  // Read-only parse so the form can echo the understood destinations (option-1 hybrid).
  async previewDestinations(region: string, nights: number): Promise<ReturnType<DestinationParser['parseHeuristic']>> {
    return this.destinationParser.parse(region, Math.max(1, nights));
  }

  // Nights requested by the user: flexible window days, or fixed-date span.
  private requestedNights(input: CreateTripInput): number {
    if (input.dateInput?.mode === 'flexible') return input.dateInput.days;
    const start = input.startDate ? new Date(input.startDate) : null;
    const end = input.endDate ? new Date(input.endDate) : null;
    if (start && end) return Math.max(0, Math.round((end.getTime() - start.getTime()) / 86_400_000));
    return 0;
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
    this.engine.run(tripId).catch((err: unknown) => {
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
      rejectionReason: trip.rejectionReason ?? null,
      workflowState: trip.workflowState ?? null,
      overBudget: trip.workflowContext?.overBudget ?? null,
      createdAt: trip.createdAt,
      updatedAt: trip.updatedAt,
    };
  }

  private toDebugView(
    rawProposals: Proposal[],
    rawLogs: AgentLog[],
    rawMetrics: TripMetric[],
  ): Pick<TripDebugView, 'proposals' | 'agentLogs' | 'metrics' | 'scores' | 'commits'> {
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
        // Proposal's own action column is authoritative (e.g. finance's
        // accept/reject verdict) — AgentLog.action describes the call type
        // (merge/review/estimate) and must not clobber it.
        action: p.action ?? log?.action ?? p.status,
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

    const totalTokensUsed = rawLogs.reduce((s, l) => s + (l.tokensUsed ?? 0), 0);
    const times = rawLogs.map((l) => new Date(l.createdAt).getTime());
    const totalTimeMs =
      times.length > 1 ? Math.max(...times) - Math.min(...times) : 0;

    const latestMetric = rawMetrics[rawMetrics.length - 1];
    const metrics: TripMetricsDto[] = latestMetric
      ? [{
          fairnessScore,
          autonomyScore,
          totalTimeMs: latestMetric.totalTimeMs ?? totalTimeMs,
          totalTokensUsed: latestMetric.totalTokensUsed ?? totalTokensUsed,
          financeBlockCount: latestMetric.financeBlockCount ?? 0,
          logisticsBlockCount: latestMetric.logisticsBlockCount ?? 0,
        }]
      : [];

    const orchestratorProposals = rawProposals.filter((p) => p.agent === 'orchestrator');

    const commits: CommitEntryDto[] = [];
    for (const p of orchestratorProposals) {
      const content = p.content as Record<string, unknown> | undefined;
      const decisions = Array.isArray(content?.['decisions']) ? content!['decisions'] : [];
      for (const raw of decisions) {
        if (typeof raw !== 'object' || raw === null) continue;
        const d = raw as Record<string, unknown>;
        const status = d['status'];
        if (status !== 'accepted' && status !== 'merged' && status !== 'rejected') continue;
        commits.push({
          id: typeof d['proposalId'] === 'string' ? d['proposalId'] : `${p.id}-${commits.length}`,
          agent: typeof d['agent'] === 'string' ? d['agent'] : p.agent,
          round: p.round,
          action: status,
          activity: typeof d['activity'] === 'string' ? d['activity'] : undefined,
          city: typeof d['city'] === 'string' ? d['city'] : undefined,
          reason: typeof d['reason'] === 'string' ? d['reason'] : undefined,
          createdAt: toIso(p.createdAt),
        });
      }
    }
    const financeVerdict = rawProposals.find(
      (p) => p.agent === 'finance' && p.round === 2 && (p.action === 'accept' || p.action === 'reject'),
    );
    if (financeVerdict) {
      commits.push({
        id: financeVerdict.id,
        agent: 'finance',
        round: financeVerdict.round,
        action: financeVerdict.action as 'accept' | 'reject',
        reason: financeVerdict.reasoning ?? undefined,
        createdAt: toIso(financeVerdict.createdAt),
      });
    }

    // Win-rate proxy: share of each persona agent's proposals that made it
    // into the final itinerary (accepted/merged vs rejected).
    const scores: AgentWinRateDto[] = [];
    for (const p of orchestratorProposals) {
      const content = p.content as Record<string, unknown> | undefined;
      // `satisfactionEstimates` is the pre-M109 name for the same win-rate map —
      // still read so proposals already in the DB keep rendering.
      const rates = (content?.['agentWinRates'] ?? content?.['satisfactionEstimates']) as
        | Record<string, unknown>
        | undefined;
      if (!rates || typeof rates !== 'object') continue;
      for (const [agent, value] of Object.entries(rates)) {
        if (typeof value !== 'number') continue;
        scores.push({ agent, winRate: value });
      }
    }

    return {
      proposals,
      agentLogs,
      metrics,
      scores,
      commits,
    };
  }
}

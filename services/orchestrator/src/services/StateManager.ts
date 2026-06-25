import { BaseService, NotFoundError } from '@itinera/shared';
import type { TripStatus } from '@itinera/shared';
import { AppDataSource } from '@/data-source';
import { Trip } from '@/entities/Trip';
import { Traveller } from '@/entities/Traveller';
import { Proposal } from '@/entities/Proposal';
import { AgentLog } from '@/entities/AgentLog';
import { TripMetric } from '@/entities/TripMetric';

type ProposalAction = 'propose' | 'refine' | 'accept' | 'reject';

interface SaveProposalParams {
  tripId: string;
  agent: string;
  round: number;
  content: Record<string, unknown>;
  score?: number;
  action?: ProposalAction;
  reasoning?: string;
}

interface SaveFinalMetricParams {
  tripId: string;
  round: number;
  consensusScore?: number;
  convergenceRounds: number;
  forcedConvergence: boolean;
  financeBlockCount: number;
  logisticsBlockCount: number;
  totalTokensUsed: number;
  totalTimeMs: number;
  metadata?: Record<string, unknown>;
}

interface LogAgentCallParams {
  tripId: string;
  agent: string;
  round: number;
  action: string;
  latencyMs?: number;
  tokensUsed?: number;
  reasoning?: string;
}

interface SaveMetricParams {
  tripId: string;
  round: number;
  consensusScore?: number;
  conflictCount?: number;
  metadata?: Record<string, unknown>;
}

export class StateManager extends BaseService {
  constructor() {
    super('state-manager');
  }

  async transitionStatus(tripId: string, status: TripStatus, fromStatus?: TripStatus): Promise<void> {
    const where = fromStatus ? { id: tripId, status: fromStatus } : { id: tripId };
    const result = await AppDataSource.getRepository(Trip).update(where, { status });
    if (result.affected === 0) {
      if (fromStatus) {
        // Another process already transitioned away from fromStatus — not an error
        this.logger.warn('Status transition skipped — already moved', { tripId, fromStatus, toStatus: status });
        return;
      }
      throw new NotFoundError(`Trip ${tripId}`);
    }
    this.logger.info('Trip status updated', { tripId, status });
  }

  // Atomically claim a trip for negotiation. Returns false if already claimed.
  async claimNegotiating(tripId: string): Promise<boolean> {
    const result = await AppDataSource.getRepository(Trip).update(
      { id: tripId, status: 'draft' as TripStatus },
      { status: 'negotiating' as TripStatus },
    );
    return (result.affected ?? 0) > 0;
  }

  async getTrip(tripId: string): Promise<Trip | null> {
    return AppDataSource.getRepository(Trip).findOne({
      where: { id: tripId },
      relations: ['travellers', 'proposals', 'metrics', 'owner'],
    });
  }

  async getTravellers(tripId: string): Promise<Traveller[]> {
    return AppDataSource.getRepository(Traveller).find({ where: { tripId } });
  }

  async saveProposal(params: SaveProposalParams): Promise<Proposal> {
    const repo = AppDataSource.getRepository(Proposal);
    const proposal = repo.create({
      tripId: params.tripId,
      agent: params.agent,
      round: params.round,
      content: params.content,
      score: params.score ?? null,
      status: 'pending',
      action: params.action ?? null,
      reasoning: params.reasoning ?? null,
    });
    return repo.save(proposal);
  }

  async logAgentCall(params: LogAgentCallParams): Promise<void> {
    const repo = AppDataSource.getRepository(AgentLog);
    const log = repo.create({
      tripId: params.tripId,
      agent: params.agent,
      round: params.round,
      action: params.action,
      latencyMs: params.latencyMs ?? null,
      tokensUsed: params.tokensUsed ?? null,
      reasoning: params.reasoning ?? null,
    });
    await repo.save(log);
  }

  async saveMetric(params: SaveMetricParams): Promise<void> {
    const repo = AppDataSource.getRepository(TripMetric);
    const metric = repo.create({
      tripId: params.tripId,
      round: params.round,
      consensusScore: params.consensusScore ?? null,
      conflictCount: params.conflictCount ?? 0,
      metadata: params.metadata ?? {},
    });
    await repo.save(metric);
  }

  // Final aggregate metric written once the loop exits — the research signal.
  async saveFinalMetric(params: SaveFinalMetricParams): Promise<void> {
    const repo = AppDataSource.getRepository(TripMetric);
    const metric = repo.create({
      tripId: params.tripId,
      round: params.round,
      consensusScore: params.consensusScore ?? null,
      convergenceRounds: params.convergenceRounds,
      forcedConvergence: params.forcedConvergence,
      financeBlockCount: params.financeBlockCount,
      logisticsBlockCount: params.logisticsBlockCount,
      totalTokensUsed: params.totalTokensUsed,
      totalTimeMs: params.totalTimeMs,
      metadata: params.metadata ?? {},
    });
    await repo.save(metric);
  }

  // Mark a trip rejected (budget impossible) with the reason shown to the user.
  async rejectTrip(tripId: string, reason: string): Promise<void> {
    await AppDataSource.getRepository(Trip).update(
      { id: tripId },
      { status: 'rejected' as TripStatus, rejectionReason: reason },
    );
    this.logger.info('Trip rejected', { tripId, reason });
  }
}

import { BaseService } from '@itinera/shared';
import type { AgentEvent } from '@itinera/shared';
import { AppDataSource } from '@/data-source';
import { Proposal } from '@/entities/Proposal';

export class ProposalStorageService extends BaseService {
  constructor() {
    super('proposal-storage');
  }

  async save(event: AgentEvent): Promise<void> {
    const repo = AppDataSource.getRepository(Proposal);

    const proposal = repo.create({
      tripId: event.tripId,
      agent: event.agent,
      round: event.round,
      content: event.content as Record<string, unknown>,
      status: 'pending',
    });

    await repo.save(proposal);

    this.logger.debug('Proposal stored', {
      tripId: event.tripId,
      agent: event.agent,
      round: event.round,
    });
  }

  async findLatestByTripId(tripId: string, round?: number): Promise<Proposal | null> {
    const repo = AppDataSource.getRepository(Proposal);

    const qb = repo
      .createQueryBuilder('proposal')
      .where('proposal.trip_id = :tripId', { tripId })
      .andWhere('proposal.agent = :agent', { agent: 'finance' })
      .orderBy('proposal.created_at', 'DESC')
      .limit(1);

    if (round !== undefined) {
      qb.andWhere('proposal.round = :round', { round });
    }

    return qb.getOne();
  }
}

import { BaseService } from '@itinera/shared';
import type { AgentEvent } from '@itinera/shared';

/**
 * Orchestrator-agent's merge/repair/analysis agents never persist proposals
 * directly — the orchestrator service is the sole writer (see WorkflowEngine
 * / validator's ProposalStorageService). This is a no-DB stub, injected into
 * every agent purely so their unit tests can assert the "don't double-save"
 * invariant: calling save() here is a programming error, not a degraded
 * write path.
 */
export class ProposalStorageService extends BaseService {
  constructor() {
    super('proposal-storage');
  }

  async save(event: AgentEvent): Promise<void> {
    this.logger.error('ProposalStorageService.save() called from orchestrator-agent — agents must not persist proposals directly', {
      tripId: event.tripId,
      agent: event.agent,
    });
    throw new Error('orchestrator-agent does not persist proposals — the orchestrator service does');
  }
}

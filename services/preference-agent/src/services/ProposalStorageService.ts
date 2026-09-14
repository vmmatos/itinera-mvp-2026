import { BaseService } from '@itinera/shared';
import type { AgentEvent } from '@itinera/shared';

/**
 * Preference agents never persist proposals directly — the orchestrator is
 * the sole writer (see WorkflowEngine / validator's ProposalStorageService).
 * This is a no-DB stub, injected into every agent purely so BaseAgent.test.ts
 * can assert the "don't double-save" invariant: calling save() here is a
 * programming error, not a degraded write path.
 */
export class ProposalStorageService extends BaseService {
  constructor() {
    super('proposal-storage');
  }

  async save(event: AgentEvent): Promise<void> {
    this.logger.error('ProposalStorageService.save() called from preference-agent — agents must not persist proposals directly', {
      tripId: event.tripId,
      agent: event.agent,
    });
    throw new Error('preference-agent does not persist proposals — the orchestrator does');
  }
}

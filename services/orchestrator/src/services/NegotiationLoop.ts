import { BaseService } from '@itinera/shared';
import type { AgentName } from '@itinera/shared';
import { StateManager } from '@/services/StateManager';
import { AgentCaller } from '@/services/AgentCaller';
import { EventPublisher } from '@/services/EventPublisher';

const PREFERENCE_AGENTS: AgentName[] = ['alice', 'bob', 'carlos', 'diana'];

type RoundName = 'preferences' | 'analyze' | 'propose' | 'finance' | 'logistics' | 'refine';
const ROUNDS: RoundName[] = ['preferences', 'analyze', 'propose', 'finance', 'logistics', 'refine'];

export class NegotiationLoop extends BaseService {
  constructor(
    private readonly stateManager: StateManager,
    private readonly agentCaller: AgentCaller,
    private readonly eventPublisher: EventPublisher,
  ) {
    super('negotiation-loop');
  }

  async run(tripId: string): Promise<void> {
    this.logger.info('Negotiation loop started', { tripId });

    try {
      await this.stateManager.transitionStatus(tripId, 'negotiating');

      let latestProposal: Record<string, unknown> = {};

      for (let i = 0; i < ROUNDS.length; i++) {
        const round = i + 1;
        const roundName = ROUNDS[i] as RoundName;
        this.logger.info('Round started', { tripId, round, roundName });

        switch (roundName) {
          case 'preferences':
            latestProposal = await this.runPreferencesRound(tripId, round);
            break;
          case 'analyze':
            latestProposal = await this.runAnalyzeRound(tripId, round, [latestProposal]);
            break;
          case 'propose':
            latestProposal = await this.runProposeRound(tripId, round, latestProposal);
            break;
          case 'finance':
            latestProposal = await this.runFinanceRound(tripId, round, latestProposal);
            break;
          case 'logistics':
            latestProposal = await this.runLogisticsRound(tripId, round, latestProposal);
            break;
          case 'refine':
            latestProposal = await this.runRefineRound(tripId, round, latestProposal);
            break;
        }

        await this.stateManager.saveMetric({
          tripId,
          round,
          metadata: { roundName, proposal: latestProposal },
        });

        await this.eventPublisher.publish('orchestrator', 'propose', {
          tripId,
          type: `orchestrator.round.${roundName}`,
          agent: 'orchestrator',
          round,
          timestamp: new Date().toISOString(),
          content: latestProposal,
        });
      }

      await this.stateManager.transitionStatus(tripId, 'confirmed');
      this.logger.info('Negotiation loop completed', { tripId });
    } catch (err) {
      this.logger.error('Negotiation loop failed', { tripId, error: String(err) });
      await this.stateManager.transitionStatus(tripId, 'cancelled').catch(() => undefined);
    }
  }

  private async runPreferencesRound(
    tripId: string,
    round: number,
  ): Promise<Record<string, unknown>> {
    const results: Record<string, unknown>[] = [];
    for (const agentName of PREFERENCE_AGENTS) {
      const start = Date.now();
      const result = await this.agentCaller.callPreferenceAgent(tripId, agentName, round);
      await this.stateManager.saveProposal({ tripId, agent: agentName, round, content: result.content });
      await this.stateManager.logAgentCall({
        tripId,
        agent: agentName,
        round,
        action: 'propose',
        latencyMs: Date.now() - start,
        tokensUsed: result.tokensUsed,
        reasoning: result.reasoning,
      });
      results.push(result.content);
    }
    return { preferences: results };
  }

  private async runAnalyzeRound(
    tripId: string,
    round: number,
    proposals: Record<string, unknown>[],
  ): Promise<Record<string, unknown>> {
    const start = Date.now();
    const result = await this.agentCaller.callOrchestratorAgent(tripId, round, proposals);
    await this.stateManager.saveProposal({ tripId, agent: 'orchestrator', round, content: result.content });
    await this.stateManager.logAgentCall({
      tripId,
      agent: 'orchestrator',
      round,
      action: 'propose',
      latencyMs: Date.now() - start,
      tokensUsed: result.tokensUsed,
      reasoning: result.reasoning,
    });
    return result.content;
  }

  private async runProposeRound(
    tripId: string,
    round: number,
    proposal: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const start = Date.now();
    const result = await this.agentCaller.callOrchestratorAgent(tripId, round, [proposal]);
    await this.stateManager.saveProposal({ tripId, agent: 'orchestrator', round, content: result.content });
    await this.stateManager.logAgentCall({
      tripId,
      agent: 'orchestrator',
      round,
      action: 'refine',
      latencyMs: Date.now() - start,
      tokensUsed: result.tokensUsed,
      reasoning: result.reasoning,
    });
    return result.content;
  }

  private async runFinanceRound(
    tripId: string,
    round: number,
    proposal: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const start = Date.now();
    const result = await this.agentCaller.callFinanceAgent(tripId, round, proposal);
    await this.stateManager.saveProposal({ tripId, agent: 'finance', round, content: result.content });
    await this.stateManager.logAgentCall({
      tripId,
      agent: 'finance',
      round,
      action: 'score',
      latencyMs: Date.now() - start,
      tokensUsed: result.tokensUsed,
      reasoning: result.reasoning,
    });
    return { ...proposal, finance: result.content };
  }

  private async runLogisticsRound(
    tripId: string,
    round: number,
    proposal: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const start = Date.now();
    const result = await this.agentCaller.callLogisticsAgent(tripId, round, proposal);
    await this.stateManager.saveProposal({ tripId, agent: 'logistics', round, content: result.content });
    await this.stateManager.logAgentCall({
      tripId,
      agent: 'logistics',
      round,
      action: 'score',
      latencyMs: Date.now() - start,
      tokensUsed: result.tokensUsed,
      reasoning: result.reasoning,
    });
    return { ...proposal, logistics: result.content };
  }

  private async runRefineRound(
    tripId: string,
    round: number,
    proposal: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const start = Date.now();
    const result = await this.agentCaller.callValidatorAgent(tripId, round, proposal);
    await this.stateManager.saveProposal({ tripId, agent: 'validator', round, content: result.content });
    await this.stateManager.logAgentCall({
      tripId,
      agent: 'validator',
      round,
      action: 'score',
      latencyMs: Date.now() - start,
      tokensUsed: result.tokensUsed,
      reasoning: result.reasoning,
    });
    return { ...proposal, validation: result.content };
  }
}

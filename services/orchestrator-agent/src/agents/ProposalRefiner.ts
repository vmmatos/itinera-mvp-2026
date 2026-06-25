import path from 'path';
import fs from 'fs';
import type { AgentEvent, AgentName, AIMessage, IAIProvider } from '@itinera/shared';
import { BaseOrchestratorAgent, ITINERARY_MAX_TOKENS } from '@/agents/BaseOrchestratorAgent';
import { RabbitMQPublisher } from '@/services/RabbitMQPublisher';
import { RedisService } from '@/services/RedisService';
import { ProposalStorageService } from '@/services/ProposalStorageService';

export class ProposalRefiner extends BaseOrchestratorAgent {
  readonly agentName: AgentName = 'orchestrator';
  readonly systemPrompt: string;

  constructor(
    aiProvider: IAIProvider,
    publisher: RabbitMQPublisher,
    redis: RedisService,
    storage: ProposalStorageService,
  ) {
    super(aiProvider, publisher, redis, storage);
    this.systemPrompt = fs.readFileSync(
      path.join(__dirname, '../config/prompts/refine.txt'),
      'utf-8',
    );
  }

  // No caching — each refinement is driven by unique feedback and must be fresh
  async refine(
    tripId: string,
    round: number,
    proposal: unknown,
    feedback: string,
    context: string,
  ): Promise<AgentEvent> {
    return this.handleAsync(async () => {
      const proposalSummary = JSON.stringify(proposal, null, 2);
      const messages: AIMessage[] = [
        {
          role: 'user',
          content: `Trip context: ${context}\n\nRound: ${round}\n\nCurrent proposal:\n${proposalSummary}\n\nFeedback to incorporate:\n${feedback}\n\nRefine the proposal based on this feedback. Respond with valid JSON only.`,
        },
      ];

      // Full itinerary JSON again — keep the large output budget so refinements don't truncate.
      return this.callAIAndBuild(tripId, round, 'refine', messages, ITINERARY_MAX_TOKENS);
    });
  }
}

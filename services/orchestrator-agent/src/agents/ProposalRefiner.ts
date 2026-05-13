import path from 'path';
import fs from 'fs';
import type { MessageParam } from '@anthropic-ai/sdk/resources/messages';
import type { AgentEvent, AgentName } from '@itinera/shared';
import { BaseOrchestratorAgent } from '@/agents/BaseOrchestratorAgent';
import { AnthropicService } from '@/services/AnthropicService';
import { RabbitMQPublisher } from '@/services/RabbitMQPublisher';
import { RedisService } from '@/services/RedisService';
import { ProposalStorageService } from '@/services/ProposalStorageService';

export class ProposalRefiner extends BaseOrchestratorAgent {
  readonly agentName: AgentName = 'orchestrator';
  readonly systemPrompt: string;

  constructor(
    anthropic: AnthropicService,
    publisher: RabbitMQPublisher,
    redis: RedisService,
    storage: ProposalStorageService,
  ) {
    super(anthropic, publisher, redis, storage);
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
      const messages: MessageParam[] = [
        {
          role: 'user',
          content: `Trip context: ${context}\n\nRound: ${round}\n\nCurrent proposal:\n${proposalSummary}\n\nFeedback to incorporate:\n${feedback}\n\nRefine the proposal based on this feedback. Respond with valid JSON only.`,
        },
      ];

      return this.callClaudeAndBuild(tripId, round, 'refine', messages);
    });
  }
}

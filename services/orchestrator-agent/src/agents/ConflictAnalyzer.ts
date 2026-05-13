import path from 'path';
import fs from 'fs';
import type { MessageParam } from '@anthropic-ai/sdk/resources/messages';
import type { AgentEvent, AgentName } from '@itinera/shared';
import { BaseOrchestratorAgent } from '@/agents/BaseOrchestratorAgent';
import { config } from '@/config';
import { AnthropicService } from '@/services/AnthropicService';
import { RabbitMQPublisher } from '@/services/RabbitMQPublisher';
import { RedisService } from '@/services/RedisService';
import { ProposalStorageService } from '@/services/ProposalStorageService';

export class ConflictAnalyzer extends BaseOrchestratorAgent {
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
      path.join(__dirname, '../config/prompts/analyze.txt'),
      'utf-8',
    );
  }

  async analyze(tripId: string, round: number, proposals: unknown[]): Promise<AgentEvent> {
    return this.handleAsync(async () => {
      const cacheKey = `orch:${tripId}:conflict-analyzer:${round}:score`;
      const cached = await this.redis.get<AgentEvent>(cacheKey);
      if (cached) {
        this.logger.info('Cache hit', { agent: this.agentName, tripId, round, action: 'score' });
        return cached;
      }

      const proposalsSummary = JSON.stringify(proposals, null, 2);
      const messages: MessageParam[] = [
        {
          role: 'user',
          content: `Trip ID: ${tripId}\nRound: ${round}\n\nAgent proposals:\n${proposalsSummary}\n\nAnalyze these proposals and identify conflicts and consensus areas. Respond with valid JSON only.`,
        },
      ];

      const event = await this.callClaudeAndBuild(tripId, round, 'score', messages);
      await this.redis.set(cacheKey, event, config.CACHE_TTL_SECONDS);
      return event;
    });
  }
}

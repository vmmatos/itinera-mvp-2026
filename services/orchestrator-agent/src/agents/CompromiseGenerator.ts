import path from 'path';
import fs from 'fs';
import type { AgentEvent, AgentName, AIMessage, IAIProvider } from '@itinera/shared';
import { BaseOrchestratorAgent, ITINERARY_MAX_TOKENS } from '@/agents/BaseOrchestratorAgent';
import { config } from '@/config';
import { RabbitMQPublisher } from '@/services/RabbitMQPublisher';
import { RedisService } from '@/services/RedisService';
import { ProposalStorageService } from '@/services/ProposalStorageService';

export class CompromiseGenerator extends BaseOrchestratorAgent {
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
      path.join(__dirname, '../config/prompts/propose.txt'),
      'utf-8',
    );
  }

  async generateCompromise(
    tripId: string,
    round: number,
    conflicts: unknown,
    context: string,
  ): Promise<AgentEvent> {
    return this.handleAsync(async () => {
      const cacheKey = `orch:${tripId}:compromise-generator:${round}:propose`;
      const cached = await this.redis.get<AgentEvent>(cacheKey);
      if (cached) {
        this.logger.info('Cache hit', { agent: this.agentName, tripId, round, action: 'propose' });
        return cached;
      }

      const conflictsSummary = JSON.stringify(conflicts, null, 2);
      const messages: AIMessage[] = [
        {
          role: 'user',
          content: `Trip context: ${context}\n\nRound: ${round}\n\nConflict analysis:\n${conflictsSummary}\n\nGenerate a compromise itinerary that satisfies as many agents as possible. Respond with valid JSON only.`,
        },
      ];

      // Full multi-day, multi-city itinerary JSON — needs a large output budget or it truncates.
      const event = await this.callAIAndBuild(tripId, round, 'propose', messages, ITINERARY_MAX_TOKENS);
      await this.redis.set(cacheKey, event, config.CACHE_TTL_SECONDS);
      return event;
    });
  }
}

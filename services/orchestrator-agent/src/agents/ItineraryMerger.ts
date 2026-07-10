import path from 'path';
import fs from 'fs';
import type { AgentEvent, AgentName, AIMessage, IAIProvider, RouteGraph, BudgetPlan } from '@itinera/shared';
import { BaseOrchestratorAgent, ITINERARY_MAX_TOKENS } from '@/agents/BaseOrchestratorAgent';
import { config } from '@/config';
import { RabbitMQPublisher } from '@/services/RabbitMQPublisher';
import { RedisService } from '@/services/RedisService';
import { ProposalStorageService } from '@/services/ProposalStorageService';

export class ItineraryMerger extends BaseOrchestratorAgent {
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
      path.join(__dirname, '../config/prompts/merge.txt'),
      'utf-8',
    );
  }

  async merge(
    tripId: string,
    round: number,
    routeGraph: RouteGraph,
    touristOutputs: Record<string, unknown>,
    budgetPlan: BudgetPlan,
    context: string,
    targetCity: string,
  ): Promise<AgentEvent> {
    return this.handleAsync(async () => {
      const cacheKey = `orch:${tripId}:merger:${round}:merge:${targetCity}`;
      const cached = await this.redis.get<AgentEvent>(cacheKey);
      if (cached) {
        this.logger.info('Cache hit', { agent: this.agentName, tripId, round, action: 'merge', targetCity });
        return cached;
      }

      const messages: AIMessage[] = [
        {
          role: 'user',
          content: [
            `Trip context: ${context}`,
            `Round: ${round}`,
            `Target city for this call: ${targetCity}. Only output itinerary days, decisions, and accommodation for this city — see SCOPE OF THIS CALL in the system prompt.`,
            '',
            'ROUTE GRAPH (structural skeleton — city order, dates, and time windows are FIXED):',
            JSON.stringify(routeGraph, null, 2),
            '',
            'BUDGET PLAN (per-block allocations — stay within these limits):',
            JSON.stringify(budgetPlan, null, 2),
            '',
            'TOURIST AGENT PROPOSALS (slot-based experiences to merge; only use the ones whose city matches the target city):',
            JSON.stringify(touristOutputs, null, 2),
            '',
            `Merge the tourist proposals for ${targetCity} into that city's itinerary days. Respect the route graph exactly. Respond with valid JSON only.`,
          ].join('\n'),
        },
      ];

      // strict: a truncated/invalid merge silently defaulted to an empty itinerary
      // downstream (WorkflowEngine), which broke transport injection, restriction
      // checks, and weather assessment without ever surfacing an error. Throwing
      // here lets the existing MERGE_AND_SCORE retry/abandon state-machine logic
      // handle it instead.
      const event = await this.callAIAndBuild(tripId, round, 'propose', messages, ITINERARY_MAX_TOKENS, true);
      await this.redis.set(cacheKey, event, config.CACHE_TTL_SECONDS);
      return event;
    });
  }
}

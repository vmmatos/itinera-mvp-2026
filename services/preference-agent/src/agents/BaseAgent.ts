import { BaseService, buildRoutingKey } from '@itinera/shared';
import type { AgentEvent, AgentName, AgentAction, AIMessage, IAIProvider, TouristSlotInput } from '@itinera/shared';
import { RabbitMQPublisher } from '@/services/RabbitMQPublisher';
import { RedisService } from '@/services/RedisService';
import { ProposalStorageService } from '@/services/ProposalStorageService';

const CACHE_TTL_SECONDS = 3600;

export abstract class BaseAgent extends BaseService {
  abstract readonly agentName: AgentName;
  abstract readonly systemPrompt: string;
  // Slot-aware prompt used in the v2 workflow. Subclasses set this when loaded.
  slotSystemPrompt?: string;

  constructor(
    protected readonly aiProvider: IAIProvider,
    protected readonly publisher: RabbitMQPublisher,
    protected readonly redis: RedisService,
    protected readonly storage: ProposalStorageService,
  ) {
    super('base-agent');
  }

  async propose(tripId: string, round: number, context: string): Promise<AgentEvent> {
    return this.handleAsync(async () => {
      const cacheKey = this.getCacheKey(tripId, round, 'propose');
      const cached = await this.redis.get<AgentEvent>(cacheKey);
      if (cached) {
        this.logger.info('Cache hit', { agent: this.agentName, tripId, round, action: 'propose' });
        return cached;
      }

      const messages: AIMessage[] = [
        {
          role: 'user',
          content: `Trip context: ${context}\n\nRound: ${round}\n\nPlease propose your ideal itinerary for this group trip. Respond with valid JSON only.`,
        },
      ];

      const event = await this.callAIAndBuild(tripId, round, 'propose', messages);
      await this.redis.set(cacheKey, event, CACHE_TTL_SECONDS);
      return event;
    });
  }

  async react(
    tripId: string,
    round: number,
    proposals: unknown[],
    context: string,
  ): Promise<AgentEvent> {
    return this.handleAsync(async () => {
      const cacheKey = this.getCacheKey(tripId, round, 'refine');
      const cached = await this.redis.get<AgentEvent>(cacheKey);
      if (cached) {
        this.logger.info('Cache hit', { agent: this.agentName, tripId, round, action: 'refine' });
        return cached;
      }

      const proposalsSummary = JSON.stringify(proposals, null, 2);
      const messages: AIMessage[] = [
        {
          role: 'user',
          content: `Trip context: ${context}\n\nRound: ${round}\n\nExisting proposals from other agents:\n${proposalsSummary}\n\nReact to these proposals from your perspective and suggest refinements. Respond with valid JSON only.`,
        },
      ];

      const event = await this.callAIAndBuild(tripId, round, 'refine', messages);
      await this.redis.set(cacheKey, event, CACHE_TTL_SECONDS);
      return event;
    });
  }

  async proposeForSlot(tripId: string, round: number, slots: TouristSlotInput[]): Promise<AgentEvent> {
    return this.handleAsync(async () => {
      const cacheKey = `${this.getCacheKey(tripId, round, 'propose')}:slots`;
      const cached = await this.redis.get<AgentEvent>(cacheKey);
      if (cached) {
        this.logger.info('Cache hit', { agent: this.agentName, tripId, round, action: 'propose-slot' });
        return cached;
      }

      const systemPrompt = this.slotSystemPrompt ?? this.systemPrompt;
      const slotsJson = JSON.stringify(slots, null, 2);
      const messages: AIMessage[] = [
        {
          role: 'user',
          content: `You have been given pre-defined time slots across one or more cities. Your task is to propose experiences that fill these slots from your persona's perspective.\n\nSlots:\n${slotsJson}\n\nRound: ${round}\n\nRespond with valid JSON only.`,
        },
      ];

      const event = await this.callAIAndBuild(tripId, round, 'propose', messages, systemPrompt);
      await this.redis.set(cacheKey, event, CACHE_TTL_SECONDS);
      return event;
    });
  }

  private async callAIAndBuild(
    tripId: string,
    round: number,
    action: AgentAction,
    messages: AIMessage[],
    systemPromptOverride?: string,
  ): Promise<AgentEvent> {
    const { content, latencyMs, tokensUsed } = await this.aiProvider.complete(
      systemPromptOverride ?? this.systemPrompt,
      messages,
    );

    let parsedContent: unknown;
    try {
      parsedContent = JSON.parse(content);
    } catch {
      const stripped = content
        .replace(/^```(?:json)?\s*/im, '')
        .replace(/\s*```\s*$/m, '')
        .trim();
      try {
        parsedContent = JSON.parse(stripped);
      } catch {
        parsedContent = { raw: content };
      }
    }

    const event = this.buildAgentEvent(tripId, round, action, parsedContent, content, {
      latencyMs,
      tokensUsed,
    });

    // Orchestrator is responsible for persisting proposals — don't double-save here
    await this.publisher.publish(buildRoutingKey(this.agentName, action), event);

    this.logger.info('Agent call complete', {
      agent: this.agentName,
      tripId,
      round,
      action,
      latencyMs,
      tokensUsed,
    });

    return event;
  }

  private getCacheKey(tripId: string, round: number, action: string): string {
    return `pref:${tripId}:${this.agentName}:${round}:${action}`;
  }

  private buildAgentEvent(
    tripId: string,
    round: number,
    action: AgentAction,
    content: unknown,
    reasoning: string,
    metrics: { latencyMs: number; tokensUsed: number },
  ): AgentEvent {
    return {
      tripId,
      type: `agent.${action}`,
      agent: this.agentName,
      round,
      timestamp: new Date().toISOString(),
      content,
      reasoning,
      metrics,
    };
  }
}

import { BaseService, buildRoutingKey } from '@itinera/shared';
import type { AgentEvent, AgentName, AgentAction, AIMessage, IAIProvider } from '@itinera/shared';
import { RabbitMQPublisher } from '@/services/RabbitMQPublisher';
import { RedisService } from '@/services/RedisService';
import { ProposalStorageService } from '@/services/ProposalStorageService';

export abstract class BaseFinanceAgent extends BaseService {
  abstract readonly agentName: AgentName;
  abstract readonly systemPrompt: string;

  constructor(
    protected readonly aiProvider: IAIProvider,
    protected readonly publisher: RabbitMQPublisher,
    protected readonly redis: RedisService,
    protected readonly storage: ProposalStorageService,
  ) {
    super('base-finance-agent');
  }

  protected async callAIAndBuild(
    tripId: string,
    round: number,
    action: AgentAction,
    messages: AIMessage[],
  ): Promise<AgentEvent> {
    const { content, latencyMs, tokensUsed } = await this.aiProvider.complete(
      this.systemPrompt,
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

    this.logger.info('Finance agent call complete', {
      agent: this.agentName,
      tripId,
      round,
      action,
      latencyMs,
      tokensUsed,
    });

    return event;
  }

  protected async buildAndPublishEvent(
    tripId: string,
    round: number,
    action: AgentAction,
    content: unknown,
  ): Promise<AgentEvent> {
    const event = this.buildAgentEvent(tripId, round, action, content, '', undefined);

    // Orchestrator is responsible for persisting proposals — don't double-save here
    await this.publisher.publish(buildRoutingKey(this.agentName, action), event);

    this.logger.info('Finance agent event published', {
      agent: this.agentName,
      tripId,
      round,
      action,
    });

    return event;
  }

  private buildAgentEvent(
    tripId: string,
    round: number,
    action: AgentAction,
    content: unknown,
    reasoning: string,
    metrics: { latencyMs: number; tokensUsed: number } | undefined,
  ): AgentEvent {
    return {
      tripId,
      type: `agent.${action}`,
      agent: this.agentName,
      round,
      timestamp: new Date().toISOString(),
      content,
      reasoning: reasoning || undefined,
      metrics,
    };
  }
}

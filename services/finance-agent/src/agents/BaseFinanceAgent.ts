import type { MessageParam } from '@anthropic-ai/sdk/resources/messages';
import { BaseService, buildRoutingKey } from '@itinera/shared';
import type { AgentEvent, AgentName, AgentAction } from '@itinera/shared';
import { AnthropicService } from '@/services/AnthropicService';
import { RabbitMQPublisher } from '@/services/RabbitMQPublisher';
import { RedisService } from '@/services/RedisService';
import { ProposalStorageService } from '@/services/ProposalStorageService';

export abstract class BaseFinanceAgent extends BaseService {
  abstract readonly agentName: AgentName;
  abstract readonly systemPrompt: string;

  constructor(
    protected readonly anthropic: AnthropicService,
    protected readonly publisher: RabbitMQPublisher,
    protected readonly redis: RedisService,
    protected readonly storage: ProposalStorageService,
  ) {
    super('base-finance-agent');
  }

  protected async callClaudeAndBuild(
    tripId: string,
    round: number,
    action: AgentAction,
    messages: MessageParam[],
  ): Promise<AgentEvent> {
    const { content, latencyMs, tokensUsed } = await this.anthropic.complete(
      this.systemPrompt,
      messages,
    );

    let parsedContent: unknown;
    try {
      parsedContent = JSON.parse(content);
    } catch {
      parsedContent = { raw: content };
    }

    const event = this.buildAgentEvent(tripId, round, action, parsedContent, content, {
      latencyMs,
      tokensUsed,
    });

    await Promise.all([
      this.storage.save(event),
      this.publisher.publish(buildRoutingKey(this.agentName, action), event),
    ]);

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

    await Promise.all([
      this.storage.save(event),
      this.publisher.publish(buildRoutingKey(this.agentName, action), event),
    ]);

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

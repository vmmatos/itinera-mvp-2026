import type { MessageParam } from '@anthropic-ai/sdk/resources/messages';
import { BaseService, buildRoutingKey } from '@itinera/shared';
import type { AgentEvent, AgentName, AgentAction } from '@itinera/shared';
import { AnthropicService } from '@/services/AnthropicService';
import { RabbitMQPublisher } from '@/services/RabbitMQPublisher';
import { RedisService } from '@/services/RedisService';
import { ProposalStorageService } from '@/services/ProposalStorageService';

export abstract class BaseOrchestratorAgent extends BaseService {
  abstract readonly agentName: AgentName;
  abstract readonly systemPrompt: string;

  constructor(
    protected readonly anthropic: AnthropicService,
    protected readonly publisher: RabbitMQPublisher,
    protected readonly redis: RedisService,
    protected readonly storage: ProposalStorageService,
  ) {
    super('base-orchestrator-agent');
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
      // Claude sometimes wraps JSON in code fences — strip and retry before falling back to raw
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

    this.logger.info('Orchestrator agent call complete', {
      agent: this.agentName,
      tripId,
      round,
      action,
      latencyMs,
      tokensUsed,
    });

    return event;
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

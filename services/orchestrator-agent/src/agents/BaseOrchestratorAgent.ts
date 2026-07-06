import { BaseService, buildRoutingKey } from '@itinera/shared';
import type { AgentEvent, AgentName, AgentAction, AIMessage, IAIProvider } from '@itinera/shared';
import { RabbitMQPublisher } from '@/services/RabbitMQPublisher';
import { RedisService } from '@/services/RedisService';
import { ProposalStorageService } from '@/services/ProposalStorageService';
import { ProposalOutputSchema } from '@/schemas/proposalOutput.schema';
import { auditPrices } from '@/services/PriceGuard';

/** Output-token budget for the full itinerary JSON (propose/refine) so it never truncates. */
export const ITINERARY_MAX_TOKENS = 8192;

export abstract class BaseOrchestratorAgent extends BaseService {
  abstract readonly agentName: AgentName;
  abstract readonly systemPrompt: string;

  constructor(
    protected readonly aiProvider: IAIProvider,
    protected readonly publisher: RabbitMQPublisher,
    protected readonly redis: RedisService,
    protected readonly storage: ProposalStorageService,
  ) {
    super('base-orchestrator-agent');
  }

  protected async callAIAndBuild(
    tripId: string,
    round: number,
    action: AgentAction,
    messages: AIMessage[],
    maxTokens?: number,
  ): Promise<AgentEvent> {
    const opts = maxTokens ? { maxTokens } : undefined;
    let response = await this.aiProvider.complete(this.systemPrompt, messages, opts);
    let totalTokensUsed = response.tokensUsed;
    let totalLatencyMs = response.latencyMs;

    let parsedContent = this.tryParseJSON(response.content);

    // G2: validate proposal structure; if invalid, retry once with the error details.
    if (action === 'propose' || action === 'refine') {
      const validation = ProposalOutputSchema.safeParse(parsedContent);
      if (!validation.success && !('raw' in (parsedContent as Record<string, unknown>))) {
        const issues = validation.error.issues
          .slice(0, 5)
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; ');
        this.logger.warn('Proposal failed schema validation — retrying', { tripId, round, issues });

        const retryMessages: AIMessage[] = [
          ...messages,
          { role: 'assistant', content: response.content },
          {
            role: 'user',
            content: `Your response failed JSON schema validation: ${issues}. Please reply with corrected JSON only, no explanation.`,
          },
        ];
        const retried = await this.aiProvider.complete(this.systemPrompt, retryMessages, opts);
        totalTokensUsed += retried.tokensUsed;
        totalLatencyMs += retried.latencyMs;
        parsedContent = this.tryParseJSON(retried.content);
      }

      // G4: price sanity audit — log suspicious costs but never hard-fail.
      const finalValidation = ProposalOutputSchema.safeParse(parsedContent);
      if (finalValidation.success) {
        auditPrices(finalValidation.data, this.logger);
      }
    }

    const event = this.buildAgentEvent(tripId, round, action, parsedContent, response.content, {
      latencyMs: totalLatencyMs,
      tokensUsed: totalTokensUsed,
    });

    // Orchestrator is responsible for persisting proposals — don't double-save here
    await this.publisher.publish(buildRoutingKey(this.agentName, action), event);

    this.logger.info('Orchestrator agent call complete', {
      agent: this.agentName,
      tripId,
      round,
      action,
      latencyMs: totalLatencyMs,
      tokensUsed: totalTokensUsed,
    });

    return event;
  }

  private tryParseJSON(content: string): unknown {
    try {
      return JSON.parse(content);
    } catch {
      const stripped = content
        .replace(/^```(?:json)?\s*/im, '')
        .replace(/\s*```\s*$/m, '')
        .trim();
      try {
        return JSON.parse(stripped);
      } catch {
        return { raw: content };
      }
    }
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

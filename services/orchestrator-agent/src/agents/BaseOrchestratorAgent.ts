import { BaseService, buildRoutingKey } from '@itinera/shared';
import type { AgentEvent, AgentName, AgentAction, AIMessage, IAIProvider } from '@itinera/shared';
import { RabbitMQPublisher } from '@/services/RabbitMQPublisher';
import { RedisService } from '@/services/RedisService';
import { ProposalStorageService } from '@/services/ProposalStorageService';
import { ProposalOutputSchema } from '@/schemas/proposalOutput.schema';
import { RepairOutputSchema } from '@/schemas/repairOutput.schema';
import { auditPrices } from '@/services/PriceGuard';

/**
 * Output-token budget for the full itinerary JSON (propose/refine) so it never truncates.
 * 8192 was too tight for 3+ destination trips — bumped to leave real headroom (model supports
 * up to 64k output tokens). Truncation is still detected and retried/rejected — see `strict` below.
 */
export const ITINERARY_MAX_TOKENS = 32000;

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
    /** When true, a still-invalid (or still-truncated/non-JSON) response after retry throws instead of being returned as-is. Only ItineraryMerger opts in — its output feeds transport/restrictions/weather downstream and a `{raw}` fallback there silently breaks all three. */
    strict = false,
  ): Promise<AgentEvent> {
    const opts = maxTokens ? { maxTokens } : undefined;
    let response = await this.aiProvider.complete(this.systemPrompt, messages, opts);
    let totalTokensUsed = response.tokensUsed;
    let totalLatencyMs = response.latencyMs;
    let wasTruncated = response.truncated ?? false;

    let parsedContent = this.tryParseJSON(response.content);

    // G2: validate proposal structure; if invalid, retry once with the error details.
    if (action === 'propose' || action === 'refine') {
      const isRawFallback = (c: unknown): boolean => typeof c === 'object' && c !== null && 'raw' in c;

      let validation = ProposalOutputSchema.safeParse(parsedContent);
      if (!validation.success && (strict || !isRawFallback(parsedContent))) {
        const issues = validation.error.issues
          .slice(0, 5)
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; ');
        const truncationNote = wasTruncated
          ? ' Your previous response was truncated for exceeding the output length limit — produce a shorter, more concise itinerary (fewer words per description) that still fits, with complete valid JSON.'
          : '';
        this.logger.warn('Proposal failed schema validation — retrying', { tripId, round, issues, wasTruncated });

        const retryMessages: AIMessage[] = [
          ...messages,
          { role: 'assistant', content: response.content },
          {
            role: 'user',
            content: `Your response failed JSON schema validation: ${issues}.${truncationNote} Please reply with corrected JSON only, no explanation.`,
          },
        ];
        const retried = await this.aiProvider.complete(this.systemPrompt, retryMessages, opts);
        totalTokensUsed += retried.tokensUsed;
        totalLatencyMs += retried.latencyMs;
        wasTruncated = retried.truncated ?? false;
        parsedContent = this.tryParseJSON(retried.content);
        validation = ProposalOutputSchema.safeParse(parsedContent);
      }

      if (strict && !validation.success) {
        this.logger.error('Proposal still invalid after retry — aborting', {
          tripId, round, agent: this.agentName, wasTruncated,
        });
        throw new Error(`${this.agentName} agent failed to produce a valid itinerary after retry (truncated=${wasTruncated})`);
      }

      // G4: price sanity audit — log suspicious costs but never hard-fail.
      if (validation.success) {
        auditPrices(validation.data, this.logger);
      }
    }

    // Repair output is an edit list, not an itinerary — validated against its
    // own schema with the same retry-once recipe as proposals above.
    if (action === 'repair') {
      let validation = RepairOutputSchema.safeParse(parsedContent);
      if (!validation.success) {
        const issues = validation.error.issues
          .slice(0, 5)
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; ');
        this.logger.warn('Repair output failed schema validation — retrying', { tripId, round, issues });

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
        wasTruncated = retried.truncated ?? false;
        parsedContent = this.tryParseJSON(retried.content);
        validation = RepairOutputSchema.safeParse(parsedContent);
      }

      if (strict && !validation.success) {
        this.logger.error('Repair output still invalid after retry — aborting', {
          tripId, round, agent: this.agentName, wasTruncated,
        });
        throw new Error(`${this.agentName} agent failed to produce a valid repair edit list after retry`);
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

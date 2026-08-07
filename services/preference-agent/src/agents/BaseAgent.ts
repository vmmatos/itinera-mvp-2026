import { randomUUID } from 'crypto';
import type { ZodTypeAny } from 'zod';
import { BaseService, buildRoutingKey } from '@itinera/shared';
import type { AgentEvent, AgentName, AgentAction, AIMessage, IAIProvider, TouristSlotInput } from '@itinera/shared';
import { RabbitMQPublisher } from '@/services/RabbitMQPublisher';
import { RedisService } from '@/services/RedisService';
import { ProposalStorageService } from '@/services/ProposalStorageService';
import { SlotProposalsOutputSchema } from '@/schemas/slotProposalOutput.schema';
import { findBudgetOverruns, buildBudgetCorrectionMessage } from '@/agents/budgetCheck';

const CACHE_TTL_SECONDS = 3600;

/**
 * Output-token budget for proposeForSlot. A persona proposes across every
 * slot in the trip (all cities) in one call — 4096 (AnthropicService's
 * default) truncates mid-JSON on anything past a small 1-2 city trip, and
 * silently degraded to unusable {raw} content with no error surfaced
 * anywhere (see the retry-on-truncation logic below, mirroring
 * BaseOrchestratorAgent's pattern for the same class of failure on the merge
 * side).
 */
const PROPOSE_SLOTS_MAX_TOKENS = 16000;

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

      const event = await this.callAIAndBuild(
        tripId, round, 'propose', messages, systemPrompt,
        PROPOSE_SLOTS_MAX_TOKENS, SlotProposalsOutputSchema, slots,
      );
      await this.redis.set(cacheKey, event, CACHE_TTL_SECONDS);
      return event;
    });
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

  private async callAIAndBuild(
    tripId: string,
    round: number,
    action: AgentAction,
    messages: AIMessage[],
    systemPromptOverride?: string,
    maxTokens?: number,
    /** When provided, a still-invalid (or still-truncated/non-JSON) response
     * after one retry throws instead of silently saving {raw} content — a
     * silent {raw} fallback here is indistinguishable downstream from "this
     * persona had nothing to propose," which hides the failure entirely. */
    schema?: ZodTypeAny,
    /** When provided, proposals are re-asked once if they exceed a city's
     * `budgetPerPersonBlock` — see the budget enforcement block below. */
    slots?: TouristSlotInput[],
  ): Promise<AgentEvent> {
    const opts = maxTokens ? { maxTokens } : undefined;
    const systemPrompt = systemPromptOverride ?? this.systemPrompt;
    let response = await this.aiProvider.complete(systemPrompt, messages, opts);
    let totalTokensUsed = response.tokensUsed;
    let totalLatencyMs = response.latencyMs;
    let wasTruncated = response.truncated ?? false;
    let parsedContent = this.tryParseJSON(response.content);

    if (schema) {
      let validation = schema.safeParse(parsedContent);

      if (!validation.success) {
        const issues = validation.error.issues
          .slice(0, 5)
          .map((i: { path: (string | number)[]; message: string }) => `${i.path.join('.')}: ${i.message}`)
          .join('; ');
        const truncationNote = wasTruncated
          ? ' Your previous response was truncated for exceeding the output length limit — produce a shorter, more concise set of proposals (fewer words per description) that still fits, with complete valid JSON.'
          : '';
        this.logger.warn('Slot proposal failed schema validation — retrying', {
          agent: this.agentName, tripId, round, issues, wasTruncated,
        });

        const retryMessages: AIMessage[] = [
          ...messages,
          { role: 'assistant', content: response.content },
          {
            role: 'user',
            content: `Your response failed JSON schema validation: ${issues}.${truncationNote} Please reply with corrected JSON only, no explanation.`,
          },
        ];
        const retried = await this.aiProvider.complete(systemPrompt, retryMessages, opts);
        totalTokensUsed += retried.tokensUsed;
        totalLatencyMs += retried.latencyMs;
        wasTruncated = retried.truncated ?? false;
        parsedContent = this.tryParseJSON(retried.content);
        response = retried;
        validation = schema.safeParse(parsedContent);
      }

      if (!validation.success) {
        this.logger.error('Slot proposal still invalid after retry — aborting', {
          agent: this.agentName, tripId, round, wasTruncated,
        });
        throw new Error(`${this.agentName} agent failed to produce valid slot proposals after retry (truncated=${wasTruncated})`);
      }

      // The budget already reaches the model (TouristSlotInput.budgetPerPersonBlock
      // is serialised into the prompt, and every *-slots.txt tells it to stay
      // within that figure) but that is instruction-only — nothing stopped a
      // persona proposing well past it, which is how a €2200 trip produced a
      // ~€4400 itinerary and burned two full re-merge cycles downstream before
      // being caught. Re-ask once with the actual numbers; if it still overshoots,
      // let it through rather than dropping the persona's proposals entirely —
      // starving a persona is its own failure mode, and finance now contributes
      // to the combined validation score instead of acting as a hard gate.
      if (slots && slots.length > 0) {
        const proposalsForCheck =
          (parsedContent as { slotProposals?: Array<Record<string, unknown>> }).slotProposals ?? [];
        const overruns = findBudgetOverruns(proposalsForCheck, slots);

        if (overruns.length > 0) {
          this.logger.warn('Slot proposals exceed city experiences budget — re-asking', {
            agent: this.agentName, tripId, round, overruns,
          });

          const retryMessages: AIMessage[] = [
            ...messages,
            { role: 'assistant', content: response.content },
            { role: 'user', content: buildBudgetCorrectionMessage(overruns, slots[0]!.currency) },
          ];
          const retried = await this.aiProvider.complete(systemPrompt, retryMessages, opts);
          totalTokensUsed += retried.tokensUsed;
          totalLatencyMs += retried.latencyMs;

          // Only take the re-ask if it is itself schema-valid — a malformed
          // "cheaper" answer is worse than a valid over-budget one.
          const retriedParsed = this.tryParseJSON(retried.content);
          if (schema.safeParse(retriedParsed).success) {
            parsedContent = retriedParsed;
            response = retried;
            const stillOver = findBudgetOverruns(
              (retriedParsed as { slotProposals?: Array<Record<string, unknown>> }).slotProposals ?? [],
              slots,
            );
            if (stillOver.length > 0) {
              this.logger.warn('Slot proposals still over budget after re-ask — passing through to scoring', {
                agent: this.agentName, tripId, round, overruns: stillOver,
              });
            }
          } else {
            this.logger.warn('Budget re-ask returned invalid JSON — keeping original proposals', {
              agent: this.agentName, tripId, round,
            });
          }
        }
      }

      // Assign a stable id per slot proposal (the LLM never generates one) so
      // the merge stage can reference it verbatim instead of reconstructing a
      // city/date/slot string key from two independently-generated LLM outputs.
      const slotProposals = (parsedContent as { slotProposals?: Array<Record<string, unknown>> }).slotProposals;
      if (Array.isArray(slotProposals)) {
        for (const proposal of slotProposals) {
          if (typeof proposal.id !== 'string') proposal.id = randomUUID();
        }
      }
    }

    const event = this.buildAgentEvent(tripId, round, action, parsedContent, response.content, {
      latencyMs: totalLatencyMs,
      tokensUsed: totalTokensUsed,
    });

    // Orchestrator is responsible for persisting proposals — don't double-save here
    await this.publisher.publish(buildRoutingKey(this.agentName, action), event);

    this.logger.info('Agent call complete', {
      agent: this.agentName,
      tripId,
      round,
      action,
      latencyMs: totalLatencyMs,
      tokensUsed: totalTokensUsed,
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

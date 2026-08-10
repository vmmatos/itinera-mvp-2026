import path from 'path';
import fs from 'fs';
import type { AgentEvent, AgentName, AIMessage, FinanceFeedback, IAIProvider } from '@itinera/shared';
import { BaseOrchestratorAgent } from '@/agents/BaseOrchestratorAgent';
import { RabbitMQPublisher } from '@/services/RabbitMQPublisher';
import { RedisService } from '@/services/RedisService';
import { ProposalStorageService } from '@/services/ProposalStorageService';

/**
 * Output budget for the edit list — an order of magnitude below the merge's
 * ITINERARY_MAX_TOKENS. The whole point of repair is fixing an over-budget
 * itinerary WITHOUT paying for a full re-merge, so the output is a handful of
 * targeted edits, never a rewritten itinerary.
 */
export const REPAIR_MAX_TOKENS = 8000;

export class ItineraryRepairer extends BaseOrchestratorAgent {
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
      path.join(__dirname, '../config/prompts/repair.txt'),
      'utf-8',
    );
  }

  async repair(
    tripId: string,
    round: number,
    itinerary: unknown[],
    accommodation: unknown[],
    financeFeedback: FinanceFeedback,
    budgetTotal: number,
    budgetCurrency: string,
    groupSize: number,
    /** Group total the repaired trip must come in at or below (budget × tolerance). */
    targetTotal: number,
  ): Promise<AgentEvent> {
    return this.handleAsync(async () => {
      // No cache: each repair round runs against a different itinerary/feedback
      // pair, and `round` alone can't distinguish them reliably.
      const messages: AIMessage[] = [
        {
          role: 'user',
          content: [
            `Budget: ${budgetTotal} ${budgetCurrency} for ${groupSize} traveller(s).`,
            `Budget target after repair (group total, tolerance included): ${targetTotal} ${budgetCurrency}.`,
            '',
            'FINANCE FEEDBACK:',
            JSON.stringify(financeFeedback, null, 2),
            '',
            'CURRENT ITINERARY (real per-person prices):',
            JSON.stringify(itinerary, null, 2),
            '',
            'ACCOMMODATION:',
            JSON.stringify(accommodation, null, 2),
            '',
            `Return the smallest edit list that brings the group total to ${targetTotal} ${budgetCurrency} or below. Respond with valid JSON only.`,
          ].join('\n'),
        },
      ];

      // strict: an invalid edit list is useless downstream — throwing lets the
      // state machine's finance retry/abandon logic decide what happens next.
      return this.callAIAndBuild(tripId, round, 'repair', messages, REPAIR_MAX_TOKENS, true);
    });
  }
}

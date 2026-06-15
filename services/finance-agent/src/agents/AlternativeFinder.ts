import * as fs from 'fs';
import * as path from 'path';
import { BaseFinanceAgent } from '@/agents/BaseFinanceAgent';
import type { CostBreakdown } from '@/agents/CostCalculator';
import type { BudgetValidation } from '@/agents/BudgetValidator';
import type { AgentEvent, AgentName } from '@itinera/shared';

export class AlternativeFinder extends BaseFinanceAgent {
  readonly agentName: AgentName = 'finance';
  readonly systemPrompt: string;

  constructor(
    ...args: ConstructorParameters<typeof BaseFinanceAgent>
  ) {
    super(...args);
    this.systemPrompt = fs.readFileSync(
      path.join(__dirname, '../config/prompts/budget-negotiator.txt'),
      'utf-8',
    );
  }

  async findAlternatives(
    tripId: string,
    round: number,
    proposal: unknown,
    breakdown: CostBreakdown,
    validation: BudgetValidation,
    context: string,
    dateInput?: { mode: string; preferredMonth?: string; window?: string; days?: number } | null,
  ): Promise<AgentEvent> {
    if (validation.status === 'within_budget') {
      const content = {
        costBreakdown: breakdown,
        budgetValidation: validation,
      };
      return this.buildAndPublishEvent(tripId, round, 'propose', content);
    }

    const flexPricingNote: string[] = dateInput?.mode === 'flexible' && dateInput.preferredMonth
      ? [
          `PRICING NOTE: Dates are flexible — ${dateInput.days ?? '?'} days in ${dateInput.preferredMonth} (window: ${dateInput.window ?? 'moderate'}).`,
          'Consider weekday vs weekend rates, public holidays in that month, and shoulder-season accommodation when suggesting alternatives.',
          '',
        ]
      : [];

    const userMessage = [
      ...flexPricingNote,
      `Trip context: ${context || 'No additional context provided.'}`,
      '',
      `Budget constraint: ${validation.budgetTotal} ${validation.currency}`,
      `Total cost: ${breakdown.grandTotal} ${breakdown.currency}`,
      `Over budget by: ${validation.overAmount} ${validation.currency} (${validation.percentageUsed}% of budget used)`,
      '',
      'Cost breakdown by category:',
      `  Activities: ${breakdown.byCategory.activities}`,
      `  Meals: ${breakdown.byCategory.meals}`,
      `  Transport: ${breakdown.byCategory.transport}`,
      '',
      'Full itinerary:',
      JSON.stringify(proposal, null, 2),
    ].join('\n');

    const event = await this.callAIAndBuild(tripId, round, 'propose', [
      { role: 'user', content: userMessage },
    ]);

    const alternatives = event.content;
    const mergedContent = {
      costBreakdown: breakdown,
      budgetValidation: validation,
      alternatives,
    };

    return {
      ...event,
      content: mergedContent,
    };
  }
}

import type { FinanceVerdict } from '@itinera/shared';
import type { CostBreakdown } from '@/agents/CostCalculator';
import type { BudgetValidation } from '@/agents/BudgetValidator';

interface AlternativesSummary {
  totalPotentialSaving?: number;
  revisedBudgetEstimate?: number;
}

/**
 * Derive Finance's stance on the current proposal (card #79).
 *
 * `approved`       — fits the budget right now.
 * `budgetFeasible` — can be made to fit after the maximum suggested savings;
 *                    when false, the Orchestrator rejects the trip and asks the
 *                    user to reformulate (raise budget / reduce scope).
 */
export function buildFinanceVerdict(
  breakdown: CostBreakdown,
  validation: BudgetValidation,
  alternatives?: AlternativesSummary | null,
): FinanceVerdict {
  const { currency, budgetTotal } = validation;

  if (validation.status === 'within_budget') {
    return {
      approved: true,
      budgetFeasible: true,
      issues: [],
      reasoning: `Within budget — ${validation.percentageUsed}% of ${budgetTotal} ${currency} used.`,
    };
  }

  const over = validation.overAmount ?? Math.max(0, breakdown.grandTotal - budgetTotal);

  if (validation.status === 'within_tolerance') {
    const tolerancePct = validation.tolerancePct ?? 0;
    return {
      approved: true,
      budgetFeasible: true,
      withinTolerance: true,
      issues: [
        `Over budget by ${over} ${currency} (${validation.percentageUsed}% — within ${tolerancePct}% tolerance)`,
      ],
      reasoning: `Over budget by ${over} ${currency} but inside the ${tolerancePct}% tolerance band — approved with warning.`,
    };
  }

  const issues: string[] = [
    `Over budget by ${over} ${currency} (${validation.percentageUsed}% of budget used)`,
  ];

  // Point the Orchestrator at the category driving the overrun.
  const categories = Object.entries(breakdown.byCategory) as Array<[string, number]>;
  const topCategory = categories.sort((a, b) => b[1] - a[1])[0];
  if (topCategory && topCategory[1] > 0) {
    issues.push(`Largest cost category is ${topCategory[0]} (${topCategory[1]} ${currency})`);
  }

  const revised = alternatives?.revisedBudgetEstimate;
  const budgetFeasible = typeof revised === 'number' ? revised <= budgetTotal : false;

  if (!budgetFeasible) {
    issues.push(
      typeof revised === 'number'
        ? `Even after maximum savings the trip costs ~${revised} ${currency}, still above the ${budgetTotal} ${currency} budget`
        : `No viable cost-saving alternatives found to fit the ${budgetTotal} ${currency} budget`,
    );
  }

  return {
    approved: false,
    budgetFeasible,
    issues,
    reasoning: budgetFeasible
      ? `Over budget but fixable via suggested alternatives (revised ~${revised} ${currency}).`
      : 'Budget is unrealistic for this trip; reformulation required.',
  };
}

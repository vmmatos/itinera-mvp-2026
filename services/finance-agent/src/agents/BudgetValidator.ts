import type { CostBreakdown } from '@/agents/CostCalculator';

export interface BudgetValidation {
  status: 'within_budget' | 'within_tolerance' | 'over_budget';
  percentageUsed: number;
  remaining: number;
  overAmount?: number;
  budgetTotal: number;
  currency: string;
  /** Tolerance band (in %) the validation was run with — absent/0 means strict. */
  tolerancePct?: number;
}

export class BudgetValidator {
  validate(
    breakdown: CostBreakdown,
    budgetTotal: number,
    currency: string,
    tolerancePct: number = 0,
  ): BudgetValidation {
    const { grandTotal } = breakdown;
    const percentageUsed = Math.round((grandTotal / budgetTotal) * 10000) / 100;
    const remaining = budgetTotal - grandTotal;

    if (grandTotal <= budgetTotal) {
      return {
        status: 'within_budget',
        percentageUsed,
        remaining,
        budgetTotal,
        currency,
        tolerancePct,
      };
    }

    const toleranceCeiling = budgetTotal * (1 + tolerancePct / 100);

    return {
      status: grandTotal <= toleranceCeiling ? 'within_tolerance' : 'over_budget',
      percentageUsed,
      remaining,
      overAmount: grandTotal - budgetTotal,
      budgetTotal,
      currency,
      tolerancePct,
    };
  }
}

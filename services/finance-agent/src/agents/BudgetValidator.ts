import type { CostBreakdown } from '@/agents/CostCalculator';

export interface BudgetValidation {
  status: 'within_budget' | 'over_budget';
  percentageUsed: number;
  remaining: number;
  overAmount?: number;
  budgetTotal: number;
  currency: string;
}

export class BudgetValidator {
  validate(breakdown: CostBreakdown, budgetTotal: number, currency: string): BudgetValidation {
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
      };
    }

    return {
      status: 'over_budget',
      percentageUsed,
      remaining,
      overAmount: grandTotal - budgetTotal,
      budgetTotal,
      currency,
    };
  }
}

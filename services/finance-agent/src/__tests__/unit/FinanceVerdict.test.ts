import { describe, it, expect } from 'vitest';
import { buildFinanceVerdict } from '@/services/FinanceVerdict';
import type { CostBreakdown } from '@/agents/CostCalculator';
import type { BudgetValidation } from '@/agents/BudgetValidator';

function breakdown(activities: number, meals: number, transport: number, accommodation = 0): CostBreakdown {
  const grandTotal = accommodation + activities + meals + transport;
  return {
    byCategory: { accommodation, activities, meals, transport },
    perPersonTotal: grandTotal,
    grandTotal,
    groupSize: 1,
    currency: 'EUR',
    items: [],
  };
}

describe('buildFinanceVerdict', () => {
  it('approves and flags feasible when within budget', () => {
    const validation: BudgetValidation = {
      status: 'within_budget',
      percentageUsed: 80,
      remaining: 200,
      budgetTotal: 1000,
      currency: 'EUR',
    };

    const verdict = buildFinanceVerdict(breakdown(400, 300, 100), validation);

    expect(verdict.approved).toBe(true);
    expect(verdict.budgetFeasible).toBe(true);
    expect(verdict.issues).toEqual([]);
  });

  it('approves with warning when over budget but within tolerance', () => {
    const validation: BudgetValidation = {
      status: 'within_tolerance',
      percentageUsed: 100.53,
      remaining: -18,
      overAmount: 18,
      budgetTotal: 3400,
      currency: 'EUR',
      tolerancePct: 10,
    };

    const verdict = buildFinanceVerdict(breakdown(2018, 1000, 400), validation);

    expect(verdict.approved).toBe(true);
    expect(verdict.budgetFeasible).toBe(true);
    expect(verdict.withinTolerance).toBe(true);
    expect(verdict.issues[0]).toContain('Over budget by 18 EUR');
    expect(verdict.issues[0]).toContain('within 10% tolerance');
  });

  it('does not set withinTolerance when strictly within budget', () => {
    const validation: BudgetValidation = {
      status: 'within_budget',
      percentageUsed: 80,
      remaining: 200,
      budgetTotal: 1000,
      currency: 'EUR',
      tolerancePct: 10,
    };

    const verdict = buildFinanceVerdict(breakdown(400, 300, 100), validation);

    expect(verdict.approved).toBe(true);
    expect(verdict.withinTolerance).toBeUndefined();
  });

  it('blocks but stays feasible when over budget yet fixable via alternatives', () => {
    const validation: BudgetValidation = {
      status: 'over_budget',
      percentageUsed: 120,
      remaining: -200,
      overAmount: 200,
      budgetTotal: 1000,
      currency: 'EUR',
    };

    const verdict = buildFinanceVerdict(breakdown(800, 300, 100), validation, { revisedBudgetEstimate: 950 });

    expect(verdict.approved).toBe(false);
    expect(verdict.budgetFeasible).toBe(true);
    expect(verdict.issues[0]).toContain('Over budget by 200 EUR');
    // Largest category surfaced for the orchestrator.
    expect(verdict.issues.some((i) => i.includes('activities'))).toBe(true);
  });

  it('marks budget infeasible when even max savings exceed the budget', () => {
    const validation: BudgetValidation = {
      status: 'over_budget',
      percentageUsed: 250,
      remaining: -1500,
      overAmount: 1500,
      budgetTotal: 1000,
      currency: 'EUR',
    };

    const verdict = buildFinanceVerdict(breakdown(2000, 400, 100), validation, { revisedBudgetEstimate: 1800 });

    expect(verdict.approved).toBe(false);
    expect(verdict.budgetFeasible).toBe(false);
    expect(verdict.reasoning).toContain('unrealistic');
  });

  it('marks budget infeasible when no alternatives are provided', () => {
    const validation: BudgetValidation = {
      status: 'over_budget',
      percentageUsed: 130,
      remaining: -300,
      overAmount: 300,
      budgetTotal: 1000,
      currency: 'EUR',
    };

    const verdict = buildFinanceVerdict(breakdown(900, 300, 100), validation, null);

    expect(verdict.budgetFeasible).toBe(false);
    expect(verdict.issues.some((i) => i.includes('No viable cost-saving alternatives'))).toBe(true);
  });
});

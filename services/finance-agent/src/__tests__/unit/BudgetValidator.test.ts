import { describe, it, expect } from 'vitest';
import { BudgetValidator } from '@/agents/BudgetValidator';
import type { CostBreakdown } from '@/agents/CostCalculator';

const validator = new BudgetValidator();

function makeBreakdown(grandTotal: number): CostBreakdown {
  return {
    byCategory: { activities: grandTotal, meals: 0, transport: 0 },
    grandTotal,
    currency: 'EUR',
    items: [],
  };
}

describe('BudgetValidator', () => {
  it('status is within_budget when cost is below budget', () => {
    const result = validator.validate(makeBreakdown(800), 1000, 'EUR');
    expect(result.status).toBe('within_budget');
  });

  it('status is within_budget when cost exactly equals budget', () => {
    const result = validator.validate(makeBreakdown(1000), 1000, 'EUR');
    expect(result.status).toBe('within_budget');
  });

  it('status is over_budget when cost exceeds budget', () => {
    const result = validator.validate(makeBreakdown(1200), 1000, 'EUR');
    expect(result.status).toBe('over_budget');
  });

  it('remaining is positive when within budget', () => {
    const result = validator.validate(makeBreakdown(800), 1000, 'EUR');
    expect(result.remaining).toBe(200);
  });

  it('remaining is negative when over budget', () => {
    const result = validator.validate(makeBreakdown(1200), 1000, 'EUR');
    expect(result.remaining).toBe(-200);
  });

  it('overAmount is populated when over budget', () => {
    const result = validator.validate(makeBreakdown(1200), 1000, 'EUR');
    expect(result.overAmount).toBe(200);
  });

  it('overAmount is undefined when within budget', () => {
    const result = validator.validate(makeBreakdown(800), 1000, 'EUR');
    expect(result.overAmount).toBeUndefined();
  });

  it('percentageUsed calculates correctly at 80%', () => {
    const result = validator.validate(makeBreakdown(800), 1000, 'EUR');
    expect(result.percentageUsed).toBe(80);
  });

  it('percentageUsed calculates correctly at 120%', () => {
    const result = validator.validate(makeBreakdown(1200), 1000, 'EUR');
    expect(result.percentageUsed).toBe(120);
  });

  it('percentageUsed rounds to 2 decimal places', () => {
    const result = validator.validate(makeBreakdown(100), 300, 'EUR');
    expect(result.percentageUsed).toBe(33.33);
  });

  it('returns the provided budgetTotal and currency', () => {
    const result = validator.validate(makeBreakdown(500), 2000, 'USD');
    expect(result.budgetTotal).toBe(2000);
    expect(result.currency).toBe('USD');
  });
});

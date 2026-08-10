import { describe, it, expect } from 'vitest';
import { BudgetValidator } from '@/agents/BudgetValidator';
import type { CostBreakdown } from '@/agents/CostCalculator';

const validator = new BudgetValidator();

function makeBreakdown(grandTotal: number): CostBreakdown {
  return {
    byCategory: { accommodation: 0, activities: grandTotal, meals: 0, transport: 0 },
    perPersonTotal: grandTotal,
    grandTotal,
    groupSize: 1,
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

  describe('tolerance band', () => {
    it('status is within_budget at exactly 100% regardless of tolerance', () => {
      const result = validator.validate(makeBreakdown(1000), 1000, 'EUR', 10);
      expect(result.status).toBe('within_budget');
    });

    it('status is within_tolerance between 100% and the tolerance ceiling', () => {
      const result = validator.validate(makeBreakdown(1050), 1000, 'EUR', 10);
      expect(result.status).toBe('within_tolerance');
      expect(result.overAmount).toBe(50);
      expect(result.tolerancePct).toBe(10);
    });

    it('status is within_tolerance at exactly the tolerance ceiling (110%)', () => {
      const result = validator.validate(makeBreakdown(1100), 1000, 'EUR', 10);
      expect(result.status).toBe('within_tolerance');
    });

    it('status is over_budget just above the tolerance ceiling', () => {
      const result = validator.validate(makeBreakdown(1101), 1000, 'EUR', 10);
      expect(result.status).toBe('over_budget');
      expect(result.overAmount).toBe(101);
    });

    it('defaults to strict validation when no tolerance is given', () => {
      const result = validator.validate(makeBreakdown(1001), 1000, 'EUR');
      expect(result.status).toBe('over_budget');
    });

    it('overAmount is still populated within tolerance', () => {
      const result = validator.validate(makeBreakdown(1018), 1000, 'EUR', 10);
      expect(result.status).toBe('within_tolerance');
      expect(result.overAmount).toBe(18);
      expect(result.remaining).toBe(-18);
    });
  });
});

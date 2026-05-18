import { describe, it, expect } from 'vitest';
import { ConstraintChecker } from '@/validators/ConstraintChecker';

const checker = new ConstraintChecker();

const makeProposal = (days: number, grandTotal?: number, travellerCount?: number): Record<string, unknown> => ({
  itinerary: Array.from({ length: days }, (_, i) => ({ day: i + 1, activities: [], meals: [], transport: [] })),
  ...(grandTotal !== undefined
    ? { finance: { breakdown: { grandTotal } } }
    : {}),
  ...(travellerCount !== undefined ? { travellerCount } : {}),
});

describe('ConstraintChecker', () => {
  it('passes when itinerary fits within durationDays', () => {
    const result = checker.check(makeProposal(5), { durationDays: 7 });
    expect(result.passed).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it('passes when itinerary exactly matches durationDays', () => {
    const result = checker.check(makeProposal(7), { durationDays: 7 });
    expect(result.passed).toBe(true);
  });

  it('violation date_range when itinerary exceeds durationDays', () => {
    const result = checker.check(makeProposal(10), { durationDays: 7 });
    expect(result.passed).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]?.type).toBe('date_range');
    expect(result.violations[0]?.severity).toBe('error');
  });

  it('passes when budget not exceeded', () => {
    const result = checker.check(makeProposal(3, 800), { budgetTotal: 1000 });
    expect(result.passed).toBe(true);
  });

  it('passes when budget exactly at limit', () => {
    const result = checker.check(makeProposal(3, 1000), { budgetTotal: 1000 });
    expect(result.passed).toBe(true);
  });

  it('violation budget when grandTotal exceeds budgetTotal', () => {
    const result = checker.check(makeProposal(3, 1200), { budgetTotal: 1000 });
    expect(result.passed).toBe(false);
    expect(result.violations.some((v) => v.type === 'budget')).toBe(true);
    expect(result.violations.find((v) => v.type === 'budget')?.severity).toBe('error');
  });

  it('no violations when constraints object is empty', () => {
    const result = checker.check(makeProposal(5), {});
    expect(result.passed).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it('multiple violations reported together', () => {
    const result = checker.check(makeProposal(10, 1500), { durationDays: 7, budgetTotal: 1000 });
    expect(result.passed).toBe(false);
    expect(result.violations).toHaveLength(2);
  });

  it('traveller_count mismatch adds warning but not error', () => {
    const result = checker.check(makeProposal(3, undefined, 3), { travellerCount: 4 });
    const v = result.violations.find((x) => x.type === 'traveller_count');
    expect(v).toBeDefined();
    expect(v?.severity).toBe('warning');
    expect(result.passed).toBe(true);
  });

  it('passed is true when only warning violations exist', () => {
    const result = checker.check(makeProposal(3, undefined, 2), { travellerCount: 4 });
    expect(result.passed).toBe(true);
  });
});

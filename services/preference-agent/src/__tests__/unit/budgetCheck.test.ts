import { describe, it, expect } from 'vitest';
import type { TouristSlotInput } from '@itinera/shared';
import { findBudgetOverruns, buildBudgetCorrectionMessage } from '@/agents/budgetCheck';

function slot(city: string, budgetPerPersonBlock: number): TouristSlotInput {
  return {
    tripId: 'trip-1',
    round: 1,
    city,
    country: 'Spain',
    dateWindow: { start: '2026-08-10', end: '2026-08-13' },
    availableTimeSlots: [],
    budgetPerPersonBlock,
    currency: 'EUR',
    pace: 'medium',
    mustHaves: [],
    avoids: [],
    groupSize: 2,
  };
}

describe('findBudgetOverruns', () => {
  it('happy path: proposals within budget produce no overrun', () => {
    const overruns = findBudgetOverruns(
      [
        { city: 'Barcelona', estimatedCostPerPerson: 40 },
        { city: 'Barcelona', estimatedCostPerPerson: 30 },
      ],
      [slot('Barcelona', 100)],
    );
    expect(overruns).toEqual([]);
  });

  it('treats spending exactly the budget as within it', () => {
    const overruns = findBudgetOverruns(
      [{ city: 'Barcelona', estimatedCostPerPerson: 100 }],
      [slot('Barcelona', 100)],
    );
    expect(overruns).toEqual([]);
  });

  it('reports the per-city overrun amount', () => {
    const overruns = findBudgetOverruns(
      [
        { city: 'Barcelona', estimatedCostPerPerson: 80 },
        { city: 'Barcelona', estimatedCostPerPerson: 55 },
      ],
      [slot('Barcelona', 100)],
    );
    expect(overruns).toEqual([
      { city: 'Barcelona', budgetPerPersonBlock: 100, proposedTotalPerPerson: 135, overByPerPerson: 35 },
    ]);
  });

  it('scores each city independently', () => {
    const overruns = findBudgetOverruns(
      [
        { city: 'Barcelona', estimatedCostPerPerson: 150 },
        { city: 'Dublin', estimatedCostPerPerson: 40 },
      ],
      [slot('Barcelona', 100), slot('Dublin', 100)],
    );
    expect(overruns).toHaveLength(1);
    expect(overruns[0]!.city).toBe('Barcelona');
  });

  it('error: a budget of 0 means unknown, not free — it is skipped, not flagged', () => {
    // WorkflowEngine.executeTouristAgents falls back to 0 when no budget block
    // matches the city; flagging that would re-ask on every such trip.
    const overruns = findBudgetOverruns(
      [{ city: 'Barcelona', estimatedCostPerPerson: 500 }],
      [slot('Barcelona', 0)],
    );
    expect(overruns).toEqual([]);
  });

  it('error: proposals for an unknown city are ignored rather than crashing', () => {
    const overruns = findBudgetOverruns(
      [{ city: 'Nowhere', estimatedCostPerPerson: 999 }],
      [slot('Barcelona', 100)],
    );
    expect(overruns).toEqual([]);
  });

  it('error: tolerates malformed proposals (missing/non-numeric cost, missing city)', () => {
    const overruns = findBudgetOverruns(
      [
        { city: 'Barcelona', estimatedCostPerPerson: 90 },
        { city: 'Barcelona' },
        { city: 'Barcelona', estimatedCostPerPerson: 'free' },
        { estimatedCostPerPerson: 500 },
      ],
      [slot('Barcelona', 100)],
    );
    expect(overruns).toEqual([]);
  });

  it('error: returns empty for no slots or no proposals', () => {
    expect(findBudgetOverruns([], [slot('Barcelona', 100)])).toEqual([]);
    expect(findBudgetOverruns([{ city: 'Barcelona', estimatedCostPerPerson: 500 }], [])).toEqual([]);
  });
});

describe('buildBudgetCorrectionMessage', () => {
  it('names each city, both figures and the overage', () => {
    const message = buildBudgetCorrectionMessage(
      [{ city: 'Barcelona', budgetPerPersonBlock: 100, proposedTotalPerPerson: 135, overByPerPerson: 35 }],
      'EUR',
    );
    expect(message).toContain('Barcelona');
    expect(message).toContain('135 EUR');
    expect(message).toContain('100 EUR');
    expect(message).toContain('over by 35');
  });

  it('tells the model to substitute cheaper options rather than drop slots', () => {
    const message = buildBudgetCorrectionMessage(
      [{ city: 'Dublin', budgetPerPersonBlock: 80, proposedTotalPerPerson: 200, overByPerPerson: 120 }],
      'EUR',
    );
    // Dropping slots would starve this persona in the merge — the exact failure
    // mode the persona-fairness work exists to prevent.
    expect(message).toMatch(/rather than dropping slots/i);
  });
});

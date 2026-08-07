import { describe, it, expect } from 'vitest';
import {
  scoreFinanceCompliance,
  scoreLogisticsCompliance,
  combineScores,
  COMBINED_PASS_THRESHOLD,
} from '@/validators/ComplianceScorer';

describe('scoreFinanceCompliance', () => {
  it('scores 100 when under budget', () => {
    expect(scoreFinanceCompliance({ budgetTotal: 2000, actualTotal: 1500 })).toBe(100);
  });

  it('scores 100 exactly at budget', () => {
    expect(scoreFinanceCompliance({ budgetTotal: 2000, actualTotal: 2000 })).toBe(100);
  });

  it('decays linearly for a modest overrun', () => {
    // 10% over → 80, 25% over → 50.
    expect(scoreFinanceCompliance({ budgetTotal: 2000, actualTotal: 2200 })).toBe(80);
    expect(scoreFinanceCompliance({ budgetTotal: 2000, actualTotal: 2500 })).toBe(50);
  });

  it('reaches 0 at the blowout threshold and stays there beyond it', () => {
    expect(scoreFinanceCompliance({ budgetTotal: 2000, actualTotal: 3000 })).toBe(0);
    // The real 01d32b07 shape: €2200 budget, ~€4400 itinerary (100% over).
    expect(scoreFinanceCompliance({ budgetTotal: 2200, actualTotal: 4400 })).toBe(0);
  });

  it('error: returns null for an unscoreable budget rather than treating it as infinitely over', () => {
    expect(scoreFinanceCompliance({ budgetTotal: 0, actualTotal: 500 })).toBeNull();
    expect(scoreFinanceCompliance({ budgetTotal: -100, actualTotal: 500 })).toBeNull();
    expect(scoreFinanceCompliance({ budgetTotal: Number.NaN, actualTotal: 500 })).toBeNull();
    expect(scoreFinanceCompliance({ budgetTotal: 2000, actualTotal: Number.NaN })).toBeNull();
  });
});

describe('scoreLogisticsCompliance', () => {
  it('scores 100 for a clean itinerary', () => {
    expect(scoreLogisticsCompliance({})).toBe(100);
    expect(
      scoreLogisticsCompliance({ transportDowngrades: 0, restrictionWarnings: 0, weatherRisk: 'low' }),
    ).toBe(100);
  });

  it('penalises each signal', () => {
    expect(scoreLogisticsCompliance({ transportDowngrades: 1 })).toBe(85);
    expect(scoreLogisticsCompliance({ restrictionWarnings: 2 })).toBe(80);
    expect(scoreLogisticsCompliance({ weatherRisk: 'high' })).toBe(80);
    expect(scoreLogisticsCompliance({ weatherRisk: 'medium' })).toBe(90);
  });

  it('combines penalties and floors at 0', () => {
    expect(scoreLogisticsCompliance({ transportDowngrades: 1, restrictionWarnings: 1, weatherRisk: 'medium' })).toBe(65);
    expect(scoreLogisticsCompliance({ transportDowngrades: 20 })).toBe(0);
  });
});

describe('combineScores', () => {
  it('returns 100 when every axis is perfect', () => {
    expect(combineScores(100, 100, 100).combinedScore).toBe(100);
  });

  it('weights persona as the primary axis', () => {
    // 0.55*100 + 0.30*50 + 0.15*100 = 85
    expect(combineScores(100, 50, 100).combinedScore).toBe(85);
  });

  it('caps a budget blowout below the pass threshold even with a perfect persona fit', () => {
    // Without the cap this weighted blend is 70 and would confirm a trip the
    // group cannot afford.
    const result = combineScores(100, 0, 100);
    expect(result.combinedScore).toBe(COMBINED_PASS_THRESHOLD - 1);
    expect(result.cappedByBudget).toBe(true);
  });

  it('does not flag cappedByBudget when the score already fails on its own', () => {
    const result = combineScores(20, 0, 40);
    expect(result.combinedScore).toBeLessThan(COMBINED_PASS_THRESHOLD);
    expect(result.cappedByBudget).toBeUndefined();
  });

  it('renormalises when an axis has no data, instead of scoring it as zero', () => {
    // Persona-only must stay equal to the persona score, or every trip on an
    // older orchestrator build would suddenly fail.
    expect(combineScores(80, null, null).combinedScore).toBe(80);
    // Persona + logistics: 0.55/0.70 and 0.15/0.70 renormalised.
    expect(combineScores(100, null, 100).combinedScore).toBe(100);
  });

  it('reports the per-axis breakdown it was given', () => {
    expect(combineScores(70, 60, 90)).toMatchObject({
      personaScore: 70,
      financeScore: 60,
      logisticsScore: 90,
    });
  });
});

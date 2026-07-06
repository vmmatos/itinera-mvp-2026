import { describe, it, expect } from 'vitest';
import { buildLogisticsVerdict } from '@/services/LogisticsVerdict';
import type { TimingValidationResult } from '@/validators/TimingValidator';
import type { TransportOption } from '@itinera/shared';

const NO_TIMING: TimingValidationResult = { valid: true, conflicts: [], warnings: [] };

function option(overrides: Partial<TransportOption> = {}): TransportOption {
  return { mode: 'train', durationMinutes: 90, priceEur: 50, warnings: [], ...overrides };
}

describe('buildLogisticsVerdict', () => {
  it('approves when feasible with no warnings', () => {
    const verdict = buildLogisticsVerdict({
      overallRisk: 'low',
      aiTimingIssues: [],
      timingResult: NO_TIMING,
      restrictionWarnings: [],
      transportOptions: { 1: [option()] },
    });

    expect(verdict.approved).toBe(true);
    expect(verdict.warnings).toEqual([]);
  });

  it('blocks on high weather risk', () => {
    const verdict = buildLogisticsVerdict({
      overallRisk: 'high',
      aiTimingIssues: [],
      timingResult: NO_TIMING,
      restrictionWarnings: [],
      transportOptions: {},
    });

    expect(verdict.approved).toBe(false);
    expect(verdict.reasoning).toContain('high weather risk');
  });

  it('blocks on a critical timing conflict', () => {
    const timingResult: TimingValidationResult = {
      valid: false,
      conflicts: [{ day: 1, activity1: 'A', activity2: 'B', conflictType: 'overlap', severity: 'critical', description: 'overlap' }],
      warnings: [],
    };

    const verdict = buildLogisticsVerdict({
      overallRisk: 'low',
      aiTimingIssues: [],
      timingResult,
      restrictionWarnings: [],
      transportOptions: {},
    });

    expect(verdict.approved).toBe(false);
    expect(verdict.warnings.some((w) => w.includes('overlap'))).toBe(true);
  });

  it('warns on a long travel day (>4h) — folded #72', () => {
    const verdict = buildLogisticsVerdict({
      overallRisk: 'low',
      aiTimingIssues: [],
      timingResult: NO_TIMING,
      restrictionWarnings: [],
      transportOptions: { 2: [option({ durationMinutes: 300 })] },
    });

    expect(verdict.approved).toBe(false);
    expect(verdict.warnings.some((w) => w.includes('long travel leg'))).toBe(true);
  });

  it('surfaces tight-connection warnings carried on the transport option — folded #72', () => {
    const verdict = buildLogisticsVerdict({
      overallRisk: 'low',
      aiTimingIssues: [],
      timingResult: NO_TIMING,
      restrictionWarnings: [],
      transportOptions: { 1: [option({ warnings: ['Less than 2h gap before first activity on day 2'] })] },
    });

    expect(verdict.approved).toBe(false);
    expect(verdict.warnings.some((w) => w.includes('Less than 2h gap'))).toBe(true);
  });

  it('includes AI timing issues and restriction warnings', () => {
    const verdict = buildLogisticsVerdict({
      overallRisk: 'medium',
      aiTimingIssues: [{ day: 1, issue: 'Museum closed on Monday' }],
      timingResult: NO_TIMING,
      restrictionWarnings: [{ day: 2, activityName: 'Market', warningType: 'sunday_closure', message: 'Market closed on Sunday' }],
      transportOptions: {},
    });

    expect(verdict.approved).toBe(false);
    expect(verdict.warnings.some((w) => w.includes('Museum closed on Monday'))).toBe(true);
    expect(verdict.warnings.some((w) => w.includes('Market closed on Sunday'))).toBe(true);
  });
});

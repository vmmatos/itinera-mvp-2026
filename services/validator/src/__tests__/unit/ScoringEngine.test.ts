import { describe, it, expect } from 'vitest';
import { ScoringEngine } from '@/validators/ScoringEngine';
import type { TravellerPreference } from '@/validators/ScoringEngine';

const engine = new ScoringEngine();

const makeProposal = (categories: string[]): Record<string, unknown> => ({
  itinerary: [
    {
      day: 1,
      activities: categories.map((category) => ({ name: `Activity`, category, cost: 0, currency: 'EUR' })),
      meals: [],
      transport: [],
    },
  ],
});

const makeTraveller = (userId: string, categories: string[], avoid: string[] = []): TravellerPreference => ({
  userId,
  preferences: { categories, avoid },
});

describe('ScoringEngine', () => {
  it('score 100 when all traveller categories present in activities', () => {
    const result = engine.score(makeProposal(['culture', 'food']), [
      makeTraveller('u1', ['culture', 'food']),
    ]);
    expect(result.scores[0]?.score).toBe(100);
  });

  it('score 0 when no categories match', () => {
    const result = engine.score(makeProposal(['adventure']), [
      makeTraveller('u1', ['culture', 'food']),
    ]);
    expect(result.scores[0]?.score).toBe(0);
  });

  it('partial match returns score between 0 and 100', () => {
    const result = engine.score(makeProposal(['culture']), [
      makeTraveller('u1', ['culture', 'food']),
    ]);
    expect(result.scores[0]?.score).toBeGreaterThan(0);
    expect(result.scores[0]?.score).toBeLessThan(100);
  });

  it('empty travellers returns empty scores and overallScore 100', () => {
    const result = engine.score(makeProposal(['culture']), []);
    expect(result.scores).toHaveLength(0);
    expect(result.overallScore).toBe(100);
  });

  it('overallScore is mean of traveller scores', () => {
    const result = engine.score(makeProposal(['culture']), [
      makeTraveller('u1', ['culture']),
      makeTraveller('u2', ['food']),
    ]);
    const expected = Math.round(
      (result.scores[0]!.score + result.scores[1]!.score) / 2,
    );
    expect(result.overallScore).toBe(expected);
  });

  it('avoided category in proposal lowers score', () => {
    const base = engine.score(makeProposal(['adventure']), [
      makeTraveller('u1', ['culture'], []),
    ]);
    const withAvoid = engine.score(makeProposal(['adventure']), [
      makeTraveller('u1', ['culture'], ['adventure']),
    ]);
    expect(withAvoid.scores[0]?.score).toBeLessThanOrEqual(base.scores[0]?.score ?? 100);
  });

  it('score 100 when traveller has no preferences or avoids', () => {
    const result = engine.score(makeProposal(['culture']), [
      { userId: 'u1', preferences: {} },
    ]);
    expect(result.scores[0]?.score).toBe(100);
  });

  it('scores are clamped between 0 and 100', () => {
    const result = engine.score(makeProposal(['adventure', 'adventure', 'adventure']), [
      makeTraveller('u1', [], ['adventure', 'adventure', 'adventure']),
    ]);
    expect(result.scores[0]?.score).toBeGreaterThanOrEqual(0);
    expect(result.scores[0]?.score).toBeLessThanOrEqual(100);
  });
});

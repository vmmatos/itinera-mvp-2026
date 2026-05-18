import { describe, it, expect } from 'vitest';
import { MetricsCollector } from '@/validators/MetricsCollector';
import type { TravellerScore } from '@/validators/ScoringEngine';

const collector = new MetricsCollector();

const scores = (values: number[]): TravellerScore[] =>
  values.map((score, i) => ({ userId: `u${i}`, score }));

describe('MetricsCollector', () => {
  it('convergenceRounds equals the round number', () => {
    const result = collector.collect({ round: 4, scores: [] });
    expect(result.convergenceRounds).toBe(4);
  });

  it('autonomyPct 100 when all scores >= 60', () => {
    const result = collector.collect({ round: 1, scores: scores([60, 75, 90]) });
    expect(result.autonomyPct).toBe(100);
  });

  it('autonomyPct 0 when all scores < 60', () => {
    const result = collector.collect({ round: 1, scores: scores([10, 30, 59]) });
    expect(result.autonomyPct).toBe(0);
  });

  it('autonomyPct 50 when half scores >= 60', () => {
    const result = collector.collect({ round: 1, scores: scores([80, 40]) });
    expect(result.autonomyPct).toBe(50);
  });

  it('autonomyPct 100 when no travellers', () => {
    const result = collector.collect({ round: 1, scores: [] });
    expect(result.autonomyPct).toBe(100);
  });

  it('totalTokens equals tokensUsed', () => {
    const result = collector.collect({ round: 1, scores: [], tokensUsed: 5000 });
    expect(result.totalTokens).toBe(5000);
  });

  it('totalTokens is 0 when tokensUsed not provided', () => {
    const result = collector.collect({ round: 1, scores: [] });
    expect(result.totalTokens).toBe(0);
  });

  it('estimatedCostUsd calculated at 3 per million tokens', () => {
    const result = collector.collect({ round: 1, scores: [], tokensUsed: 1_000_000 });
    expect(result.estimatedCostUsd).toBe(3);
  });

  it('estimatedCostUsd is 0 when tokensUsed is 0', () => {
    const result = collector.collect({ round: 1, scores: [], tokensUsed: 0 });
    expect(result.estimatedCostUsd).toBe(0);
  });

  it('autonomyPct rounds correctly for fractional results', () => {
    const result = collector.collect({ round: 1, scores: scores([70, 50, 80]) });
    expect(result.autonomyPct).toBe(67);
  });
});

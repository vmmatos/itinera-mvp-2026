import { describe, it, expect } from 'vitest';
import { FairnessCalculator } from '@/validators/FairnessCalculator';
import type { TravellerScore } from '@/validators/ScoringEngine';

const calculator = new FairnessCalculator();

const scores = (values: number[]): TravellerScore[] =>
  values.map((score, i) => ({ userId: `u${i}`, score }));

describe('FairnessCalculator', () => {
  it('all equal scores → stdDev 0 and fairnessScore 100', () => {
    const result = calculator.calculate(scores([80, 80, 80]));
    expect(result.stdDev).toBe(0);
    expect(result.fairnessScore).toBe(100);
  });

  it('unequal scores → stdDev > 0 and fairnessScore < 100', () => {
    const result = calculator.calculate(scores([20, 80]));
    expect(result.stdDev).toBeGreaterThan(0);
    expect(result.fairnessScore).toBeLessThan(100);
  });

  it('single score → stdDev 0 and fairnessScore 100', () => {
    const result = calculator.calculate(scores([70]));
    expect(result.stdDev).toBe(0);
    expect(result.fairnessScore).toBe(100);
  });

  it('zero scores → stdDev 0 and fairnessScore 100', () => {
    const result = calculator.calculate([]);
    expect(result.stdDev).toBe(0);
    expect(result.fairnessScore).toBe(100);
  });

  it('min and max correctly identified', () => {
    const result = calculator.calculate(scores([30, 70, 50]));
    expect(result.minScore).toBe(30);
    expect(result.maxScore).toBe(70);
  });

  it('fairnessScore is never negative', () => {
    const result = calculator.calculate(scores([0, 100]));
    expect(result.fairnessScore).toBeGreaterThanOrEqual(0);
  });

  it('stdDev rounded to 2 decimal places', () => {
    const result = calculator.calculate(scores([10, 20, 30]));
    const decimals = result.stdDev.toString().split('.')[1]?.length ?? 0;
    expect(decimals).toBeLessThanOrEqual(2);
  });

  it('equal scores at 0 → min and max both 0', () => {
    const result = calculator.calculate(scores([0, 0, 0]));
    expect(result.minScore).toBe(0);
    expect(result.maxScore).toBe(0);
  });
});

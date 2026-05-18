import type { TravellerScore } from '@/validators/ScoringEngine';

export interface FairnessResult {
  stdDev: number;
  fairnessScore: number;
  minScore: number;
  maxScore: number;
}

export class FairnessCalculator {
  calculate(scores: TravellerScore[]): FairnessResult {
    if (scores.length <= 1) {
      const only = scores[0]?.score ?? 100;
      return { stdDev: 0, fairnessScore: 100, minScore: only, maxScore: only };
    }

    const values = scores.map((s) => s.score);
    const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
    const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
    const stdDev = Math.round(Math.sqrt(variance) * 100) / 100;
    const fairnessScore = Math.max(0, Math.round(100 - stdDev));
    const minScore = Math.min(...values);
    const maxScore = Math.max(...values);

    return { stdDev, fairnessScore, minScore, maxScore };
  }
}

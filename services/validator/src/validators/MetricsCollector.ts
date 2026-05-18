import type { TravellerScore } from '@/validators/ScoringEngine';

const SATISFIED_THRESHOLD = 60;
const COST_PER_MILLION_TOKENS = 3;

export interface MetricsInput {
  round: number;
  scores: TravellerScore[];
  tokensUsed?: number;
}

export interface MetricsResult {
  convergenceRounds: number;
  autonomyPct: number;
  totalTokens: number;
  estimatedCostUsd: number;
}

export class MetricsCollector {
  collect(input: MetricsInput): MetricsResult {
    const { round, scores, tokensUsed = 0 } = input;

    const autonomyPct =
      scores.length === 0
        ? 100
        : Math.round(
            (scores.filter((s) => s.score >= SATISFIED_THRESHOLD).length / scores.length) * 100,
          );

    const estimatedCostUsd =
      Math.round((tokensUsed * COST_PER_MILLION_TOKENS) / 1_000_000 * 1_000_000) / 1_000_000;

    return {
      convergenceRounds: round,
      autonomyPct,
      totalTokens: tokensUsed,
      estimatedCostUsd,
    };
  }
}

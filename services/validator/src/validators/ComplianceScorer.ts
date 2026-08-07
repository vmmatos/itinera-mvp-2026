/**
 * Turns finance and logistics compliance into 0-100 sub-scores and blends them
 * with the persona-fit score from `ScoringEngine`.
 *
 * Why this exists: finance used to be a binary gate — a rejection forced a full
 * re-merge (~5 min) up to MAX_RETRIES_PER_MODULE, so a trip whose itinerary cost
 * twice its budget burned three full cycles before being cancelled with no
 * explanation. CLAUDE.md describes finance as a *soft veto*; this makes that
 * true by giving it an axis in the score instead of a veto over the flow.
 * Logistics had no representation in scoring at all.
 *
 * `ScoringEngine` deliberately stays pure persona-matching — combining happens
 * here so the persona score remains independently meaningful (it is what
 * `scoreFeedback.lowScoringTravellers` reports per traveller).
 */

/** Mirrors the threshold WorkflowStateMachine gates FINAL_VALIDATION on. */
export const COMBINED_PASS_THRESHOLD = 60;

const PERSONA_WEIGHT = 0.55;
const FINANCE_WEIGHT = 0.3;
const LOGISTICS_WEIGHT = 0.15;

/**
 * Over-budget percentage at which the finance axis reaches 0. Chosen so a
 * modest overrun only dampens the score (10% over → 80) while a blowout zeroes
 * the axis and trips the cap below.
 */
const FINANCE_ZERO_AT_OVER_PCT = 50;

const LOGISTICS_PENALTY_TRANSPORT_DOWNGRADE = 15;
const LOGISTICS_PENALTY_RESTRICTION = 10;
const LOGISTICS_PENALTY_WEATHER: Record<string, number> = { high: 20, medium: 10, low: 0 };

export interface FinanceComplianceInput {
  /** The group's total budget. */
  budgetTotal: number;
  /** What the merged itinerary actually costs for the group. */
  actualTotal: number;
}

export interface LogisticsComplianceInput {
  /** Legs where the traveller's transport preference could not be honoured. */
  transportDowngrades?: number;
  /** Venue closures / public-holiday conflicts found for planned activities. */
  restrictionWarnings?: number;
  /** Overall weather risk for the itinerary. */
  weatherRisk?: 'low' | 'medium' | 'high';
}

export interface ComplianceScores {
  personaScore: number;
  financeScore: number | null;
  logisticsScore: number | null;
  combinedScore: number;
  /** Set when the combined score was capped by a budget blowout. */
  cappedByBudget?: true;
}

/**
 * 100 when at or under budget, decaying linearly to 0 at
 * FINANCE_ZERO_AT_OVER_PCT over. A non-positive budget is unscoreable (returns
 * null) rather than counted as an infinite overrun.
 */
export function scoreFinanceCompliance(input: FinanceComplianceInput): number | null {
  if (!Number.isFinite(input.budgetTotal) || input.budgetTotal <= 0) return null;
  if (!Number.isFinite(input.actualTotal)) return null;
  if (input.actualTotal <= input.budgetTotal) return 100;

  const overPct = ((input.actualTotal - input.budgetTotal) / input.budgetTotal) * 100;
  const score = 100 - (overPct / FINANCE_ZERO_AT_OVER_PCT) * 100;
  return Math.max(0, Math.round(score));
}

/** 100 minus a penalty per known logistics problem. */
export function scoreLogisticsCompliance(input: LogisticsComplianceInput): number {
  let score = 100;
  score -= (input.transportDowngrades ?? 0) * LOGISTICS_PENALTY_TRANSPORT_DOWNGRADE;
  score -= (input.restrictionWarnings ?? 0) * LOGISTICS_PENALTY_RESTRICTION;
  score -= LOGISTICS_PENALTY_WEATHER[input.weatherRisk ?? 'low'] ?? 0;
  return Math.max(0, Math.min(100, Math.round(score)));
}

/**
 * Weighted blend of the three axes. Axes with no data available (finance
 * without a budget, logistics never run) are dropped and the remaining weights
 * renormalised, so a missing signal never silently scores as zero.
 *
 * A finance score of exactly 0 — the itinerary is at least
 * FINANCE_ZERO_AT_OVER_PCT% over budget — additionally caps the combined score
 * just below the pass threshold. Without this a perfect persona fit
 * (0.55 × 100) plus clean logistics (0.15 × 100) would still total 70 and
 * confirm a trip the group cannot afford.
 */
export function combineScores(
  personaScore: number,
  financeScore: number | null,
  logisticsScore: number | null,
): ComplianceScores {
  const axes: Array<{ score: number; weight: number }> = [{ score: personaScore, weight: PERSONA_WEIGHT }];
  if (financeScore !== null) axes.push({ score: financeScore, weight: FINANCE_WEIGHT });
  if (logisticsScore !== null) axes.push({ score: logisticsScore, weight: LOGISTICS_WEIGHT });

  const totalWeight = axes.reduce((sum, a) => sum + a.weight, 0);
  const weighted = axes.reduce((sum, a) => sum + a.score * a.weight, 0) / totalWeight;

  let combinedScore = Math.max(0, Math.min(100, Math.round(weighted)));
  let cappedByBudget: true | undefined;
  if (financeScore === 0 && combinedScore >= COMBINED_PASS_THRESHOLD) {
    combinedScore = COMBINED_PASS_THRESHOLD - 1;
    cappedByBudget = true;
  }

  return { personaScore, financeScore, logisticsScore, combinedScore, ...(cappedByBudget && { cappedByBudget }) };
}

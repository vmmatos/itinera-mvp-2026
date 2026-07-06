/**
 * Shared contracts for the iterative negotiation loop (card #79).
 *
 * Finance and Logistics each emit a structured verdict so the Orchestrator can
 * decide, round by round, whether the trip has converged. The Orchestrator owns
 * the final human-like decision (ship best-effort, or reject an impossible trip).
 */

/** Finance agent's stance on the current proposal. */
export interface FinanceVerdict {
  /** True when the proposal fits within budget right now. */
  approved: boolean;
  /**
   * False when the trip cannot be made affordable even after the maximum
   * suggested savings — drives the Orchestrator's reject decision.
   */
  budgetFeasible: boolean;
  /** Human-readable blocking reasons (over-budget amounts, category overruns). */
  issues: string[];
  reasoning: string;
}

/** Logistics agent's stance on the current proposal. */
export interface LogisticsVerdict {
  /** True when the itinerary is physically feasible (timing, weather, transport). */
  approved: boolean;
  /** Human-readable warnings (tight connections, long travel days, weather risk). */
  warnings: string[];
  reasoning: string;
}

/** Combined feedback handed to the Orchestrator's refine step each round. */
export interface NegotiationFeedback {
  financeIssues: string[];
  logisticsWarnings: string[];
  round: number;
  /** How many rounds remain before forced convergence — lets the model triage. */
  remainingRounds: number;
}

/** Aggregate metrics persisted at the end of the loop (the research signal). */
export interface NegotiationMetrics {
  convergenceRounds: number;
  forcedConvergence: boolean;
  financeBlockCount: number;
  logisticsBlockCount: number;
  totalTokensUsed: number;
  totalTimeMs: number;
}

export interface RoundCompleteEvent {
  type: 'round_complete';
  round: number;
  financeApproved: boolean;
  logisticsApproved: boolean;
  issues: string[];
  converged: boolean;
}

export interface NegotiationCompleteEvent {
  type: 'negotiation_complete';
  rounds: number;
  forcedConvergence: boolean;
  consensusScore: number;
  rejected: boolean;
}

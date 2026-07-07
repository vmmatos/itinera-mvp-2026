/**
 * Shared contracts for orchestrator/agent verdicts and events.
 *
 * Finance and Logistics each emit a structured verdict so the Orchestrator can
 * decide whether the trip is feasible. The Orchestrator owns the final
 * human-like decision (ship best-effort, or reject an impossible trip).
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

export interface NegotiationCompleteEvent {
  type: 'negotiation_complete';
  rounds: number;
  forcedConvergence: boolean;
  consensusScore: number;
  rejected: boolean;
}

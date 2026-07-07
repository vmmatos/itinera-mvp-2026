/**
 * Shared contracts for orchestrator/agent verdicts and events.
 *
 * Finance and Logistics each emit a structured verdict so the Orchestrator can
 * decide whether the trip is feasible. The Orchestrator owns the final
 * human-like decision (ship best-effort, or reject an impossible trip).
 */

import { z } from 'zod';

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

/** One tourist agent's proposed activity for a single route-graph slot. */
export interface SlotProposal {
  city: string;
  date: string;
  slot: 'morning' | 'afternoon' | 'evening';
  activity: string;
  venue: string;
  category?: string;
  description?: string;
  estimatedCostPerPerson: number;
  durationMinutes?: number;
  satisfies?: string[];
}

export type ProposalDecisionStatus = 'accepted' | 'merged' | 'rejected';

/**
 * Orchestrator's verdict on one input tourist-agent slot proposal, emitted
 * during merge so the frontend can show per-proposal accept/merge/reject
 * status instead of only the aggregate merged itinerary.
 */
export interface ProposalDecision {
  agent: string;
  city: string;
  date: string;
  slot: 'morning' | 'afternoon' | 'evening';
  activity: string;
  status: ProposalDecisionStatus;
  reason: string;
  estimatedCostPerPerson?: number;
}

export const ProposalDecisionSchema = z.object({
  agent: z.string(),
  city: z.string(),
  date: z.string(),
  slot: z.enum(['morning', 'afternoon', 'evening']),
  activity: z.string(),
  status: z.enum(['accepted', 'merged', 'rejected']),
  reason: z.string(),
  estimatedCostPerPerson: z.number().min(0).optional(),
});

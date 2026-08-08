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
  /**
   * True when the proposal exceeds the budget but stays inside the configured
   * tolerance band (BUDGET_TOLERANCE_PCT) — approved, but the overrun should
   * surface to the user as a warning.
   */
  withinTolerance?: boolean;
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
  /** Why the negotiation ended the way it did — always set for non-happy endings. */
  reason?: string;
  /** Present when a best-effort itinerary shipped above budget. */
  overBudget?: { amountTotal: number; pct: number };
}

/** One tourist agent's proposed activity for a single route-graph slot. */
export interface SlotProposal {
  /** Stable id assigned by preference-agent code (not the LLM) after the
   * proposal is parsed, so it survives round-tripping through the merge
   * LLM call unchanged and can be matched back reliably. */
  id: string;
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
  /** Matches SlotProposal.id — the authoritative key for the frontend to
   * resolve the originating proposal card. City/date/slot below are kept
   * for slot-grid addressing, not for identity matching. */
  proposalId: string;
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
  proposalId: z.string(),
  agent: z.string(),
  city: z.string(),
  date: z.string(),
  slot: z.enum(['morning', 'afternoon', 'evening']),
  activity: z.string(),
  status: z.enum(['accepted', 'merged', 'rejected']),
  reason: z.string(),
  estimatedCostPerPerson: z.number().min(0).optional(),
});

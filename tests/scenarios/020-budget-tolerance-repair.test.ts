import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@itinera/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@itinera/shared')>();
  return { ...actual, createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) };
});

vi.mock('@/config', () => ({
  config: {
    RABBITMQ_EXCHANGE: 'agent.events', PORT: 3001, JWT_SECRET: 'test', JWT_ISSUER: 'itinera',
    PREFERENCE_AGENT_URL: 'http://pref:3002', ORCHESTRATOR_AGENT_URL: 'http://orch:3003',
    FINANCE_AGENT_URL: 'http://fin:3004', LOGISTICS_AGENT_URL: 'http://log:3005', VALIDATOR_URL: 'http://val:3006',
    WORKFLOW_MAX_RETRIES: 2, BUDGET_TOLERANCE_PCT: 10,
  },
  getRabbitMQUrl: () => 'amqp://localhost',
}));

vi.mock('@/services/StateManager', () => ({
  StateManager: vi.fn().mockImplementation(() => ({
    claimNegotiating: vi.fn().mockResolvedValue(true),
    getTrip: vi.fn(),
    loadWorkflowContext: vi.fn().mockResolvedValue(null),
    saveWorkflowContext: vi.fn().mockResolvedValue(undefined),
    logAgentCall: vi.fn().mockResolvedValue(undefined),
    saveProposal: vi.fn().mockResolvedValue({}),
    updateProposalStatus: vi.fn().mockResolvedValue(undefined),
    saveFinalMetric: vi.fn().mockResolvedValue(undefined),
    transitionStatus: vi.fn().mockResolvedValue(undefined),
    rejectTrip: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('@/services/AgentCaller', () => ({
  AgentCaller: vi.fn().mockImplementation(() => ({
    callLogisticsPlan: vi.fn(),
    callFinanceEstimate: vi.fn(),
    callPreferenceAgentSlots: vi.fn(),
    callOrchestratorMerge: vi.fn(),
    callOrchestratorRepair: vi.fn(),
    callFinanceAgent: vi.fn(),
    callValidatorAgent: vi.fn(),
  })),
}));

vi.mock('@/services/EventPublisher', () => ({
  EventPublisher: vi.fn().mockImplementation(() => ({
    publish: vi.fn().mockResolvedValue(undefined),
    publishToExchange: vi.fn().mockResolvedValue(undefined),
  })),
}));

import { WorkflowEngine } from '@/services/WorkflowEngine';
import { WorkflowStateMachine } from '@/services/WorkflowStateMachine';
import { StateManager } from '@/services/StateManager';
import { AgentCaller } from '@/services/AgentCaller';
import { EventPublisher } from '@/services/EventPublisher';
import type { WorkflowContext } from '@itinera/shared';
import {
  TRIP_ID, MOCK_TRIP, ROUTE_GRAPH_NO_LEGS, BUDGET_PLAN_FEASIBLE,
  TOURIST_SLOT_RESULTS, MERGED_ITINERARY_CONTENT,
  FINANCE_APPROVED_RESULT, VALIDATION_PASS_RESULT, REPAIR_EDITS_RESULT,
} from './helpers/workflow-fixtures';

// ── Scenario 020: budget tolerance band + best-effort delivery ───────────────
//
// Modelled on the real trip c822a78c ("barcelona + dublin", €3400): finance
// rejected 156% → 137% → 100.53% — the trip was CONVERGING and got cancelled
// €18 from the target, reasonlessly, after ~18 min and ~434k tokens. Two
// invariants this scenario locks in:
//
// 1. TOLERANCE: an overrun inside the 10% band comes back from finance as
//    approved (withinTolerance) — the engine treats it exactly like an
//    approval and completes to confirmed. No retry burned on €18.
//
// 2. BEST-EFFORT: when the repair path cannot get the trip under the ceiling
//    (repair agent down, finance keeps rejecting) but a complete itinerary
//    exists and the budget is not structurally impossible, the trip ships
//    `confirmed` with `overBudget {amountTotal, pct}` persisted in the
//    workflow context — never a reasonless `cancelled`.

const TOLERANCE_TRIP = {
  ...MOCK_TRIP,
  name: 'porto + lisbon over-tolerance',
  budgetTotal: 2200, // fixable-reject fixture costs 2400 → €200 over, 109%
};

// Finance rejection whose costs stay ABOVE the 110% ceiling every round —
// what the engine sees when repair cannot (or fails to) cut enough.
const FINANCE_REJECTED_STUCK_RESULT = {
  content: {
    verdict: {
      approved: false,
      budgetFeasible: true, // structurally fixable — just not fixed this round
      issues: ['Over budget by 500 EUR (122% of budget used)'],
      reasoning: 'Still above the tolerance ceiling.',
    },
    budgetBreakdown: {
      grandTotal: 2700,
      budgetTotal: 2200,
      suggestedCuts: [],
    },
  },
  latencyMs: 240,
  tokensUsed: 280,
};

// Approval carrying the tolerance flag — what finance returns for a 100–110%
// overrun after this feature (see FinanceVerdict.withinTolerance).
const FINANCE_WITHIN_TOLERANCE_RESULT = {
  content: {
    verdict: {
      approved: true,
      budgetFeasible: true,
      withinTolerance: true,
      issues: ['Over budget by 200 EUR (109.09% — within 10% tolerance)'],
      reasoning: 'Over budget by 200 EUR but inside the 10% tolerance band — approved with warning.',
    },
    budgetBreakdown: { grandTotal: 2400, budgetTotal: 2200, suggestedCuts: [] },
  },
  latencyMs: 240,
  tokensUsed: 280,
};

describe('Scenario 020 — budget tolerance band and best-effort delivery', () => {
  let stateManager: StateManager;
  let agentCaller: AgentCaller;
  let eventPublisher: EventPublisher;
  let engine: WorkflowEngine;

  beforeEach(() => {
    vi.clearAllMocks();
    stateManager = new StateManager();
    agentCaller = new AgentCaller();
    eventPublisher = new EventPublisher();
    engine = new WorkflowEngine(new WorkflowStateMachine(), stateManager, agentCaller, eventPublisher);

    vi.mocked(stateManager.getTrip).mockResolvedValue(TOLERANCE_TRIP as never);
    vi.mocked(agentCaller.callLogisticsPlan).mockResolvedValue(ROUTE_GRAPH_NO_LEGS);
    vi.mocked(agentCaller.callFinanceEstimate).mockResolvedValue(BUDGET_PLAN_FEASIBLE);
    vi.mocked(agentCaller.callPreferenceAgentSlots).mockResolvedValue(TOURIST_SLOT_RESULTS);
    vi.mocked(agentCaller.callOrchestratorMerge).mockResolvedValue({
      content: MERGED_ITINERARY_CONTENT, latencyMs: 350, tokensUsed: 800,
    });
    vi.mocked(agentCaller.callValidatorAgent).mockResolvedValue(VALIDATION_PASS_RESULT);
  });

  describe('within-tolerance approval (the €18-over case)', () => {
    beforeEach(() => {
      // Finance approves first time round, flagging the tolerance overrun.
      vi.mocked(agentCaller.callFinanceAgent).mockResolvedValue(FINANCE_WITHIN_TOLERANCE_RESULT as never);
    });

    it('completes to confirmed with zero repair or re-merge rounds', async () => {
      await engine.run(TRIP_ID);
      expect(stateManager.transitionStatus).toHaveBeenCalledWith(TRIP_ID, 'confirmed');
      expect(agentCaller.callOrchestratorRepair).not.toHaveBeenCalled();
      // 2 cities × 1 merge attempt only.
      expect(agentCaller.callOrchestratorMerge).toHaveBeenCalledTimes(2);
      expect(agentCaller.callFinanceAgent).toHaveBeenCalledOnce();
    });

    it('never touches rejectTrip or a reasonless cancel', async () => {
      await engine.run(TRIP_ID);
      expect(stateManager.rejectTrip).not.toHaveBeenCalled();
      expect(stateManager.transitionStatus).not.toHaveBeenCalledWith(TRIP_ID, 'cancelled');
    });
  });

  describe('repair converges within tolerance on the second review', () => {
    beforeEach(() => {
      vi.mocked(agentCaller.callOrchestratorRepair).mockResolvedValue(REPAIR_EDITS_RESULT as never);
      vi.mocked(agentCaller.callFinanceAgent)
        .mockResolvedValueOnce(FINANCE_REJECTED_STUCK_RESULT as never)
        .mockResolvedValue(FINANCE_WITHIN_TOLERANCE_RESULT as never);
    });

    it('one repair round, then confirmed — no re-merge', async () => {
      await engine.run(TRIP_ID);
      expect(agentCaller.callOrchestratorRepair).toHaveBeenCalledOnce();
      expect(agentCaller.callOrchestratorMerge).toHaveBeenCalledTimes(2);
      expect(stateManager.transitionStatus).toHaveBeenCalledWith(TRIP_ID, 'confirmed');
    });
  });

  describe('best-effort delivery when repair never gets there', () => {
    beforeEach(() => {
      // Repair agent down every round; finance keeps rejecting above ceiling.
      vi.mocked(agentCaller.callOrchestratorRepair).mockRejectedValue(new Error('repair agent unavailable'));
      vi.mocked(agentCaller.callFinanceAgent).mockResolvedValue(FINANCE_REJECTED_STUCK_RESULT as never);
    });

    it('ships the itinerary confirmed instead of cancelling', async () => {
      await engine.run(TRIP_ID);
      expect(stateManager.transitionStatus).toHaveBeenCalledWith(TRIP_ID, 'confirmed');
      expect(stateManager.rejectTrip).not.toHaveBeenCalled();
      expect(stateManager.transitionStatus).not.toHaveBeenCalledWith(
        TRIP_ID, 'cancelled', expect.anything(), expect.anything(),
      );
    });

    it('persists overBudget evidence (amount + pct) in the workflow context', async () => {
      await engine.run(TRIP_ID);
      const savedContexts = vi.mocked(stateManager.saveWorkflowContext).mock.calls.map((c) => c[1] as WorkflowContext);
      const withOverBudget = savedContexts.find((c) => c.overBudget);
      // grandTotal 2700 vs budget 2200 → €500 over, 122.73%.
      expect(withOverBudget?.overBudget).toEqual({ amountTotal: 500, pct: 122.73 });
    });

    it('respects the retry budget: exactly 1 + WORKFLOW_MAX_RETRIES finance reviews, no re-merge ever', async () => {
      await engine.run(TRIP_ID);
      expect(agentCaller.callFinanceAgent).toHaveBeenCalledTimes(3);
      expect(agentCaller.callOrchestratorMerge).toHaveBeenCalledTimes(2); // initial per-city only
      expect(agentCaller.callPreferenceAgentSlots).toHaveBeenCalledOnce();
    });

    it('negotiation_complete carries the reason and the overBudget payload', async () => {
      await engine.run(TRIP_ID);
      const completeEvent = vi.mocked(eventPublisher.publish).mock.calls
        .map(([, , event]) => event as { type: string; content: Record<string, unknown> })
        .find((e) => e.type === 'negotiation_complete');
      expect(completeEvent).toBeDefined();
      expect(completeEvent!.content['reason']).toContain('finance failed after 2 retries');
      expect(completeEvent!.content['overBudget']).toEqual({ amountTotal: 500, pct: 122.73 });
      expect(completeEvent!.content['rejected']).toBe(false);
    });

    it('still notifies the user the itinerary is ready', async () => {
      await engine.run(TRIP_ID);
      expect(eventPublisher.publishToExchange).toHaveBeenCalledWith(
        'notifications',
        expect.any(String),
        expect.objectContaining({ type: 'itinerary_ready' }),
      );
    });
  });
});

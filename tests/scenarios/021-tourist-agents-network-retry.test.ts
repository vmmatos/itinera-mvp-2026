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
import { WorkflowStateMachine, MAX_RETRIES_PER_MODULE } from '@/services/WorkflowStateMachine';
import { StateManager } from '@/services/StateManager';
import { AgentCaller } from '@/services/AgentCaller';
import { EventPublisher } from '@/services/EventPublisher';
import {
  TRIP_ID, MOCK_TRIP, ROUTE_GRAPH_NO_LEGS, BUDGET_PLAN_FEASIBLE,
  TOURIST_SLOT_RESULTS, MERGED_ITINERARY_CONTENT,
  FINANCE_APPROVED_RESULT, VALIDATION_PASS_RESULT,
} from './helpers/workflow-fixtures';

// ── Scenario 021: PARALLEL_TURISTIC_PLANNING survives — and is bounded by —
//    network failures ──────────────────────────────────────────────────────
//
// Real trip ec37526e ("Barcelona + Lucerna + Dublin 3semanas") logged
// `workflow_context.errors: ["tourist-agents: TypeError: fetch failed" x2, ...]`
// — AgentCaller had no timeout, calls run 4-6 minutes, and
// PARALLEL_TURISTIC_PLANNING's state-machine transition was NOT a bounded
// LOCAL_RETRY: on a caught network failure it just re-emitted the same
// CALL_TOURIST_AGENTS action forever, with no retryCount guarding it — a real
// infinite-loop risk on a sustained outage, and the direct cause of the
// negotiation feed showing preference agents "called endlessly".
//
// This locks in the fix: a network failure from AgentCaller.callPreference-
// AgentSlots (already retried internally at the HTTP layer — see
// AgentCaller.test.ts for that layer) that still ends up throwing is now
// caught by executeTouristAgents, and the STATE MACHINE retries the whole
// stage up to MAX_RETRIES_PER_MODULE times before giving up — same bounded
// contract as logistics/merge/finance/validation already had.

describe('Scenario 021 — tourist agents stage recovers from and is bounded by network failures', () => {
  let stateManager: StateManager;
  let agentCaller: AgentCaller;
  let engine: WorkflowEngine;

  beforeEach(() => {
    vi.clearAllMocks();
    stateManager = new StateManager();
    agentCaller = new AgentCaller();
    engine = new WorkflowEngine(new WorkflowStateMachine(), stateManager, agentCaller, new EventPublisher());

    vi.mocked(stateManager.getTrip).mockResolvedValue(MOCK_TRIP as never);
    vi.mocked(agentCaller.callLogisticsPlan).mockResolvedValue(ROUTE_GRAPH_NO_LEGS);
    vi.mocked(agentCaller.callFinanceEstimate).mockResolvedValue(BUDGET_PLAN_FEASIBLE);
    vi.mocked(agentCaller.callOrchestratorMerge).mockResolvedValue({
      content: MERGED_ITINERARY_CONTENT, latencyMs: 350, tokensUsed: 800,
    });
    vi.mocked(agentCaller.callFinanceAgent).mockResolvedValue(FINANCE_APPROVED_RESULT);
    vi.mocked(agentCaller.callValidatorAgent).mockResolvedValue(VALIDATION_PASS_RESULT);
  });

  describe('recovers: one network failure, then a successful attempt', () => {
    beforeEach(() => {
      vi.mocked(agentCaller.callPreferenceAgentSlots)
        .mockRejectedValueOnce(new TypeError('fetch failed'))
        .mockResolvedValue(TOURIST_SLOT_RESULTS);
    });

    it('retries exactly once at the workflow level and completes to FINISH', async () => {
      await engine.run(TRIP_ID);
      expect(agentCaller.callPreferenceAgentSlots).toHaveBeenCalledTimes(2);
      expect(stateManager.transitionStatus).toHaveBeenCalledWith(TRIP_ID, 'confirmed');
    });

    it('does not re-call logistics or finance estimate for a tourist-agents retry', async () => {
      await engine.run(TRIP_ID);
      expect(agentCaller.callLogisticsPlan).toHaveBeenCalledOnce();
      expect(agentCaller.callFinanceEstimate).toHaveBeenCalledOnce();
    });

    it('merge still runs exactly once per city once the tourist agents finally succeed', async () => {
      await engine.run(TRIP_ID);
      expect(agentCaller.callOrchestratorMerge).toHaveBeenCalledTimes(ROUTE_GRAPH_NO_LEGS.cityStays.length);
    });
  });

  describe('bounded: sustained network outage never loops forever', () => {
    beforeEach(() => {
      // Every attempt fails — including the one MAX_RETRIES_PER_MODULE allows.
      vi.mocked(agentCaller.callPreferenceAgentSlots).mockRejectedValue(new TypeError('fetch failed'));
    });

    it('gives up after exactly 1 initial + MAX_RETRIES_PER_MODULE attempts, not indefinitely', async () => {
      await engine.run(TRIP_ID);
      expect(agentCaller.callPreferenceAgentSlots).toHaveBeenCalledTimes(1 + MAX_RETRIES_PER_MODULE);
    });

    it('ends the workflow at ASK_REFINEMENT instead of hanging — merge is never reached', async () => {
      await engine.run(TRIP_ID);
      expect(agentCaller.callOrchestratorMerge).not.toHaveBeenCalled();
      expect(stateManager.transitionStatus).not.toHaveBeenCalledWith(TRIP_ID, 'confirmed');
      // No mergedItinerary and a feasible budget plan -> the existing
      // finalize() path resolves this to 'cancelled' (not 'rejected').
      expect(stateManager.transitionStatus).toHaveBeenCalledWith(TRIP_ID, 'cancelled');
    });

    it('records a bounded run: exactly MAX_RETRIES_PER_MODULE tourist retries, never a partial or growing count', async () => {
      await engine.run(TRIP_ID);
      const savedContexts = vi.mocked(stateManager.saveWorkflowContext).mock.calls.map(
        (c) => c[1] as { retryCount: Record<string, number> },
      );
      const finalRetryCount = savedContexts[savedContexts.length - 1]!.retryCount;
      expect(finalRetryCount['tourist']).toBe(MAX_RETRIES_PER_MODULE);
    });
  });
});

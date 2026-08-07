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
import { WorkflowStateMachine } from '@/services/WorkflowStateMachine';
import { StateManager } from '@/services/StateManager';
import { AgentCaller } from '@/services/AgentCaller';
import { EventPublisher } from '@/services/EventPublisher';
import {
  TRIP_ID, MOCK_TRIP, ROUTE_GRAPH_NO_LEGS, BUDGET_PLAN_FEASIBLE,
  TOURIST_SLOT_RESULTS, MERGED_ITINERARY_CONTENT,
  FINANCE_REJECTED_RESULT, FINANCE_APPROVED_RESULT, VALIDATION_PASS_RESULT,
} from './helpers/workflow-fixtures';

// ── Scenario 015: finance /review rejects on attempt 1, approves on attempt 2 ─
//
// Finance agent rejects the merged itinerary on the first review (costs exceed
// allocation for one city). The state machine triggers LOCAL_RETRY for 'finance',
// which routes back through a REAL re-merge (not a re-review of the identical,
// unchanged itinerary — retrying that would just get the same rejection every
// time regardless of how much the user raises the budget). Logistics, finance
// estimate, and tourist agents must NOT be re-called — only merge + finance
// validate repeat. Second finance call approves and the flow completes to FINISH.

describe('Scenario 015 — WorkflowEngine v2: finance validate retry', () => {
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
    vi.mocked(agentCaller.callPreferenceAgentSlots).mockResolvedValue(TOURIST_SLOT_RESULTS);
    vi.mocked(agentCaller.callOrchestratorMerge).mockResolvedValue({
      content: MERGED_ITINERARY_CONTENT, latencyMs: 350, tokensUsed: 800,
    });

    // Finance rejects on first review, approves on second
    vi.mocked(agentCaller.callFinanceAgent)
      .mockResolvedValueOnce(FINANCE_REJECTED_RESULT)
      .mockResolvedValue(FINANCE_APPROVED_RESULT);

    vi.mocked(agentCaller.callValidatorAgent).mockResolvedValue(VALIDATION_PASS_RESULT);
  });

  it('finance validate called twice: once rejected, once approved', async () => {
    await engine.run(TRIP_ID);
    expect(agentCaller.callFinanceAgent).toHaveBeenCalledTimes(2);
  });

  it('logistics NOT re-called during finance validate retry', async () => {
    await engine.run(TRIP_ID);
    expect(agentCaller.callLogisticsPlan).toHaveBeenCalledOnce();
  });

  it('finance estimate NOT re-called during finance validate retry', async () => {
    await engine.run(TRIP_ID);
    expect(agentCaller.callFinanceEstimate).toHaveBeenCalledOnce();
  });

  it('tourist agents NOT re-called during finance validate retry', async () => {
    await engine.run(TRIP_ID);
    expect(agentCaller.callPreferenceAgentSlots).toHaveBeenCalledOnce();
  });

  it('merge IS re-called on finance rejection — once per city stay, for each of the two merge attempts', async () => {
    await engine.run(TRIP_ID);
    // 2 city stays × 2 merge attempts (initial + the finance-triggered retry).
    expect(agentCaller.callOrchestratorMerge).toHaveBeenCalledTimes(4);
  });

  it('the retry merge call carries a cost-cutting instruction built from the rejection, and uses a bumped round so the cache does not just replay the first attempt', async () => {
    await engine.run(TRIP_ID);
    const calls = vi.mocked(agentCaller.callOrchestratorMerge).mock.calls;
    const firstAttemptRounds = calls.slice(0, 2).map((c) => c[1]);
    const retryAttemptRounds = calls.slice(2, 4).map((c) => c[1]);
    expect(firstAttemptRounds).toEqual([1, 1]);
    expect(retryAttemptRounds).toEqual([2, 2]);

    for (const call of calls.slice(0, 2)) {
      expect(call[5] as string).not.toContain('COST-CUTTING RETRY');
    }
    for (const call of calls.slice(2, 4)) {
      const tripContext = call[5] as string;
      expect(tripContext).toContain('COST-CUTTING RETRY');
      expect(tripContext).toContain('Accommodation costs exceed allocation for Lisbon');
    }
  });

  it('flow completes to FINISH after finance validate retry', async () => {
    await engine.run(TRIP_ID);
    expect(stateManager.transitionStatus).toHaveBeenCalledWith(TRIP_ID, 'confirmed');
    expect(stateManager.saveFinalMetric).toHaveBeenCalledWith(
      expect.objectContaining({ financeBlockCount: 1 }),
    );
  });
});

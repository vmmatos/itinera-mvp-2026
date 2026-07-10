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
  TOURIST_SLOT_RESULTS, MERGED_ITINERARY_CONTENT, FINANCE_APPROVED_RESULT, VALIDATION_PASS_RESULT,
} from './helpers/workflow-fixtures';

// ── Scenario 014: merge fails on attempt 1, succeeds on attempt 2 ─────────────
//
// The orchestrator-agent /merge endpoint fails (network error) on the first call.
// The state machine triggers LOCAL_RETRY for 'merge'.
// Logistics, finance estimate, and tourist agents must NOT be re-called.
// The flow recovers and completes normally.

describe('Scenario 014 — WorkflowEngine v2: merge local retry', () => {
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

    // First merge call fails; second succeeds
    vi.mocked(agentCaller.callOrchestratorMerge)
      .mockRejectedValueOnce(new Error('orchestrator-agent returned 503: service temporarily unavailable'))
      .mockResolvedValue({ content: MERGED_ITINERARY_CONTENT, latencyMs: 400, tokensUsed: 900 });

    vi.mocked(agentCaller.callFinanceAgent).mockResolvedValue(FINANCE_APPROVED_RESULT);
    vi.mocked(agentCaller.callValidatorAgent).mockResolvedValue(VALIDATION_PASS_RESULT);
  });

  it('merge called 4 times: one call per city stay (Porto+Lisbon) per attempt, once on the failed attempt and once on the retry', async () => {
    await engine.run(TRIP_ID);
    expect(agentCaller.callOrchestratorMerge).toHaveBeenCalledTimes(4);
  });

  it('logistics NOT re-called during merge retry', async () => {
    await engine.run(TRIP_ID);
    expect(agentCaller.callLogisticsPlan).toHaveBeenCalledOnce();
  });

  it('finance estimate NOT re-called during merge retry', async () => {
    await engine.run(TRIP_ID);
    expect(agentCaller.callFinanceEstimate).toHaveBeenCalledOnce();
  });

  it('tourist agents NOT re-called during merge retry', async () => {
    await engine.run(TRIP_ID);
    expect(agentCaller.callPreferenceAgentSlots).toHaveBeenCalledOnce();
  });

  it('flow completes to FINISH after merge retry', async () => {
    await engine.run(TRIP_ID);
    expect(stateManager.transitionStatus).toHaveBeenCalledWith(TRIP_ID, 'confirmed');
  });
});

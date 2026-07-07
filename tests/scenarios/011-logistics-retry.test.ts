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

// ── Scenario 011: logistics /plan fails on attempt 1, succeeds on attempt 2 ───
//
// The state machine triggers LOCAL_RETRY for logistics when context.routeGraph is
// missing. Finance and tourist agents must NOT be called until logistics succeeds.
// Retry counter must be 1 after recovery.

describe('Scenario 011 — WorkflowEngine v2: logistics local retry', () => {
  let stateManager: StateManager;
  let agentCaller: AgentCaller;
  let engine: WorkflowEngine;

  beforeEach(() => {
    vi.clearAllMocks();
    stateManager = new StateManager();
    agentCaller = new AgentCaller();
    engine = new WorkflowEngine(new WorkflowStateMachine(), stateManager, agentCaller, new EventPublisher());

    vi.mocked(stateManager.getTrip).mockResolvedValue(MOCK_TRIP as never);

    // First call throws → no routeGraph → state machine retries; second succeeds
    vi.mocked(agentCaller.callLogisticsPlan)
      .mockRejectedValueOnce(new Error('Transport API timeout'))
      .mockResolvedValue(ROUTE_GRAPH_NO_LEGS);

    vi.mocked(agentCaller.callFinanceEstimate).mockResolvedValue(BUDGET_PLAN_FEASIBLE);
    vi.mocked(agentCaller.callPreferenceAgentSlots).mockResolvedValue(TOURIST_SLOT_RESULTS);
    vi.mocked(agentCaller.callOrchestratorMerge).mockResolvedValue({
      content: MERGED_ITINERARY_CONTENT, latencyMs: 350, tokensUsed: 800,
    });
    vi.mocked(agentCaller.callFinanceAgent).mockResolvedValue(FINANCE_APPROVED_RESULT);
    vi.mocked(agentCaller.callValidatorAgent).mockResolvedValue(VALIDATION_PASS_RESULT);
  });

  it('logistics called twice: once on failure, once on retry', async () => {
    await engine.run(TRIP_ID);
    expect(agentCaller.callLogisticsPlan).toHaveBeenCalledTimes(2);
  });

  it('finance estimate NOT called during logistics retry', async () => {
    await engine.run(TRIP_ID);

    const logCalls = vi.mocked(agentCaller.callLogisticsPlan).mock.invocationCallOrder;
    const finCalls = vi.mocked(agentCaller.callFinanceEstimate).mock.invocationCallOrder;

    // Finance must appear after the SECOND logistics call (not between them)
    expect(finCalls[0]!).toBeGreaterThan(logCalls[1]!);
  });

  it('tourist agents NOT called during logistics retry', async () => {
    await engine.run(TRIP_ID);

    const logCalls = vi.mocked(agentCaller.callLogisticsPlan).mock.invocationCallOrder;
    const touristCalls = vi.mocked(agentCaller.callPreferenceAgentSlots).mock.invocationCallOrder;

    expect(touristCalls[0]!).toBeGreaterThan(logCalls[1]!);
  });

  it('flow continues to FINISH after retry', async () => {
    await engine.run(TRIP_ID);
    expect(stateManager.transitionStatus).toHaveBeenCalledWith(TRIP_ID, 'confirmed');
  });

  it('logistics retry does not exhaust max retries (still 1 retry remaining)', async () => {
    // Verify saveFinalMetric includes logisticsBlockCount = 1 (one retry used)
    await engine.run(TRIP_ID);
    expect(stateManager.saveFinalMetric).toHaveBeenCalledWith(
      expect.objectContaining({ logisticsBlockCount: 1 }),
    );
  });
});

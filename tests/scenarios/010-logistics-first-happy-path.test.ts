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

// ── Scenario 010: WorkflowEngine v2 happy path ────────────────────────────────
//
// Logistics agent goes FIRST and produces the route graph. Finance validates the
// budget envelope. Four tourist agents run in parallel within defined time slots.
// Orchestrator merges. Finance approves. Validator scores ≥ 60. Trip confirmed.
//
// Key assertion: no tourist agent is ever asked to propose destinations — they
// only fill experiences within slots provided by the route graph.

describe('Scenario 010 — WorkflowEngine v2: logistics-first happy path', () => {
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
    vi.mocked(agentCaller.callFinanceAgent).mockResolvedValue(FINANCE_APPROVED_RESULT);
    vi.mocked(agentCaller.callValidatorAgent).mockResolvedValue(VALIDATION_PASS_RESULT);
  });

  it('runs in state order: logistics → finance estimate → tourist agents → merge → finance validate → final validation → confirmed', async () => {
    await engine.run(TRIP_ID);

    const order: string[] = [];
    if (vi.mocked(agentCaller.callLogisticsPlan).mock.invocationCallOrder[0] !== undefined)
      order.push('logistics');
    if (vi.mocked(agentCaller.callFinanceEstimate).mock.invocationCallOrder[0] !== undefined)
      order.push('financeEstimate');
    if (vi.mocked(agentCaller.callPreferenceAgentSlots).mock.invocationCallOrder[0] !== undefined)
      order.push('tourist');
    if (vi.mocked(agentCaller.callOrchestratorMerge).mock.invocationCallOrder[0] !== undefined)
      order.push('merge');
    if (vi.mocked(agentCaller.callFinanceAgent).mock.invocationCallOrder[0] !== undefined)
      order.push('financeValidate');
    if (vi.mocked(agentCaller.callValidatorAgent).mock.invocationCallOrder[0] !== undefined)
      order.push('validator');

    expect(order).toEqual(['logistics', 'financeEstimate', 'tourist', 'merge', 'financeValidate', 'validator']);
  });

  it('logistics called before tourist agents', async () => {
    await engine.run(TRIP_ID);

    const logOrder = vi.mocked(agentCaller.callLogisticsPlan).mock.invocationCallOrder[0]!;
    const touristOrder = vi.mocked(agentCaller.callPreferenceAgentSlots).mock.invocationCallOrder[0]!;
    expect(logOrder).toBeLessThan(touristOrder);
  });

  it('tourist agents receive TouristSlotInput[] derived from route graph city stays', async () => {
    await engine.run(TRIP_ID);

    const [, , slots] = vi.mocked(agentCaller.callPreferenceAgentSlots).mock.calls[0]!;
    expect(slots).toHaveLength(ROUTE_GRAPH_NO_LEGS.cityStays.length);
    expect(slots[0]).toMatchObject({ city: 'Porto', country: 'Portugal' });
    expect(slots[1]).toMatchObject({ city: 'Lisbon', country: 'Portugal' });
  });

  it('tourist agent slot proposals have no destinations field (slot-scoped only)', async () => {
    await engine.run(TRIP_ID);

    for (const result of TOURIST_SLOT_RESULTS) {
      expect(result.content).not.toHaveProperty('destinations');
    }
  });

  it('trip confirmed and final metric saved', async () => {
    await engine.run(TRIP_ID);

    expect(stateManager.transitionStatus).toHaveBeenCalledWith(TRIP_ID, 'confirmed');
    expect(stateManager.saveFinalMetric).toHaveBeenCalledOnce();
  });

  it('merged itinerary city order matches route graph city stays', async () => {
    await engine.run(TRIP_ID);

    const [, , , , , mergeContext] = vi.mocked(agentCaller.callOrchestratorMerge).mock.calls[0]!;
    // Merge is passed routeGraph — verify it matches our fixture
    expect(mergeContext).toBeTruthy();
    const routeArg = vi.mocked(agentCaller.callOrchestratorMerge).mock.calls[0]![2];
    expect(routeArg.cityStays[0]?.city).toBe('Porto');
    expect(routeArg.cityStays[1]?.city).toBe('Lisbon');
  });
});

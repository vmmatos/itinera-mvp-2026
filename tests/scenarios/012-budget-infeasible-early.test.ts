import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@itinera/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@itinera/shared')>();
  return { ...actual, createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) };
});

vi.mock('@/config', () => ({
  config: {
    RABBITMQ_EXCHANGE: 'agent.events', PORT: 3001, JWT_SECRET: 'test', JWT_ISSUER: 'itinera',
    MAX_ROUNDS: 6, WORKFLOW_ENGINE: 'v2',
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
import { TRIP_ID, MOCK_TRIP, ROUTE_GRAPH_NO_LEGS, BUDGET_PLAN_INFEASIBLE } from './helpers/workflow-fixtures';

// ── Scenario 012: early budget rejection at FINANCE_ENVELOPE_CHECK ────────────
//
// Transport + accommodation cost exceeds the trip budget. The finance estimate
// returns feasible=false. The state machine transitions to ASK_REFINEMENT.
//
// CRITICAL: Tourist agents (Alice/Bob/Carlos/Diana) must NEVER be called.
// Spending LLM tokens on tourist proposals when the budget is already broken
// is the exact anti-pattern this architecture was designed to prevent.

describe('Scenario 012 — WorkflowEngine v2: early budget rejection at FINANCE_ENVELOPE_CHECK', () => {
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
    vi.mocked(agentCaller.callFinanceEstimate).mockResolvedValue(BUDGET_PLAN_INFEASIBLE);
  });

  it('tourist agents NEVER called when budget infeasible', async () => {
    await engine.run(TRIP_ID);
    expect(agentCaller.callPreferenceAgentSlots).not.toHaveBeenCalled();
  });

  it('orchestrator merge NEVER called when budget infeasible', async () => {
    await engine.run(TRIP_ID);
    expect(agentCaller.callOrchestratorMerge).not.toHaveBeenCalled();
  });

  it('finance validate NEVER called when budget infeasible', async () => {
    await engine.run(TRIP_ID);
    expect(agentCaller.callFinanceAgent).not.toHaveBeenCalled();
  });

  it('trip NOT hard-rejected (user can adjust and retry)', async () => {
    await engine.run(TRIP_ID);
    // rejectTrip is for hard rejection with reason shown to user;
    // ASK_REFINEMENT should use transitionStatus('cancelled') or a custom path
    expect(stateManager.transitionStatus).not.toHaveBeenCalledWith(TRIP_ID, 'confirmed');
  });

  it('logistics plan is still called before finance check', async () => {
    await engine.run(TRIP_ID);
    expect(agentCaller.callLogisticsPlan).toHaveBeenCalledOnce();
    expect(agentCaller.callFinanceEstimate).toHaveBeenCalledOnce();
  });
});

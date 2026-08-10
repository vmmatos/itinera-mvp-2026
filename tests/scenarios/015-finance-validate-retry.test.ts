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
import {
  TRIP_ID, MOCK_TRIP, ROUTE_GRAPH_NO_LEGS, BUDGET_PLAN_FEASIBLE,
  TOURIST_SLOT_RESULTS, MERGED_ITINERARY_CONTENT,
  FINANCE_REJECTED_FIXABLE_RESULT, FINANCE_APPROVED_RESULT, VALIDATION_PASS_RESULT,
  REPAIR_EDITS_RESULT,
} from './helpers/workflow-fixtures';

// ── Scenario 015: finance /review rejects on attempt 1, repair fixes it ──────
//
// Finance rejects the merged itinerary on the first review (over budget with
// concrete suggested cuts). The state machine triggers LOCAL_RETRY for
// 'finance', which now routes through ITINERARY_REPAIR: one small edit-list
// call against the EXISTING itinerary, applied deterministically — NOT the
// full per-city re-merge this used to trigger (~170k tokens per cycle on real
// trips, spent in the one stage that cannot influence post-merge costs).
// Logistics, finance estimate, tourist agents, and the merge itself must NOT
// be re-called. The second finance review sees the edited itinerary, approves,
// and the flow completes to FINISH.

describe('Scenario 015 — WorkflowEngine v2: finance validate retry via repair', () => {
  let stateManager: StateManager;
  let agentCaller: AgentCaller;
  let engine: WorkflowEngine;
  let eventPublisher: EventPublisher;

  beforeEach(() => {
    vi.clearAllMocks();
    stateManager = new StateManager();
    agentCaller = new AgentCaller();
    eventPublisher = new EventPublisher();
    engine = new WorkflowEngine(new WorkflowStateMachine(), stateManager, agentCaller, eventPublisher);

    vi.mocked(stateManager.getTrip).mockResolvedValue(MOCK_TRIP as never);
    vi.mocked(agentCaller.callLogisticsPlan).mockResolvedValue(ROUTE_GRAPH_NO_LEGS);
    vi.mocked(agentCaller.callFinanceEstimate).mockResolvedValue(BUDGET_PLAN_FEASIBLE);
    vi.mocked(agentCaller.callPreferenceAgentSlots).mockResolvedValue(TOURIST_SLOT_RESULTS);
    vi.mocked(agentCaller.callOrchestratorMerge).mockResolvedValue({
      content: MERGED_ITINERARY_CONTENT, latencyMs: 350, tokensUsed: 800,
    });
    vi.mocked(agentCaller.callOrchestratorRepair).mockResolvedValue(REPAIR_EDITS_RESULT as never);

    // Finance rejects on first review, approves on second
    vi.mocked(agentCaller.callFinanceAgent)
      .mockResolvedValueOnce(FINANCE_REJECTED_FIXABLE_RESULT as never)
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

  it('merge NOT re-called on finance rejection — repair replaces the re-merge entirely', async () => {
    await engine.run(TRIP_ID);
    // 2 city stays × exactly 1 merge attempt. The old flow burned another
    // full per-city merge round here.
    expect(agentCaller.callOrchestratorMerge).toHaveBeenCalledTimes(2);
    expect(agentCaller.callOrchestratorRepair).toHaveBeenCalledOnce();
  });

  it('repair receives the finance feedback and a tolerance-inclusive budget target', async () => {
    await engine.run(TRIP_ID);
    const call = vi.mocked(agentCaller.callOrchestratorRepair).mock.calls[0]!;
    const feedback = call[4] as { overAmountTotal: number; suggestedCuts: unknown[] };
    expect(feedback.overAmountTotal).toBe(200);
    expect(feedback.suggestedCuts).toHaveLength(1);
    // Trip budget 2200 × 1.10 tolerance = 2420.
    expect(call[8]).toBe(Math.round((MOCK_TRIP.budgetTotal as number) * 1.1));
  });

  it('the second finance review sees the repaired itinerary (cut activity gone)', async () => {
    await engine.run(TRIP_ID);
    const secondReview = vi.mocked(agentCaller.callFinanceAgent).mock.calls[1]!;
    const proposal = secondReview[2] as { itinerary: Array<{ activities: Array<{ name: string }> }> };
    const day1Names = proposal.itinerary[0]!.activities.map((a) => a.name);
    expect(day1Names).not.toContain('Wine tasting in Gaia');
    expect(day1Names).toContain('Ribeira Market walk');
  });

  it('publishes agent.repair events so the negotiation feed shows the cost cut', async () => {
    await engine.run(TRIP_ID);
    const repairEvents = vi.mocked(eventPublisher.publish).mock.calls.filter(([, action]) => action === 'repair');
    expect(repairEvents.length).toBeGreaterThan(0);
  });

  it('flow completes to FINISH after finance validate retry', async () => {
    await engine.run(TRIP_ID);
    expect(stateManager.transitionStatus).toHaveBeenCalledWith(TRIP_ID, 'confirmed');
    expect(stateManager.saveFinalMetric).toHaveBeenCalledWith(
      expect.objectContaining({ financeBlockCount: 1 }),
    );
  });
});

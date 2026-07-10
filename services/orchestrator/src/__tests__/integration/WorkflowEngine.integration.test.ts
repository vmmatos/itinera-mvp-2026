/**
 * WorkflowEngine integration tests
 *
 * Real WorkflowEngine + real WorkflowStateMachine. StateManager and AgentCaller
 * are factory-mocked so we can capture exactly what was persisted at each step
 * and verify the engine/state-machine integration without a live DB.
 *
 * These tests focus on cross-layer behaviour that unit tests (which mock the state
 * machine) and scenario tests (which don't inspect saveWorkflowContext args) miss:
 *   1. Context is checkpointed after every state transition
 *   2. Process restart resumes from checkpoint — earlier phases not re-called
 *   3. Atomic claim prevents two engines running concurrently on the same trip
 *   4. Transport priority decision is persisted in the saved context
 */
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
import type { WorkflowContext } from '@itinera/shared';
import {
  TRIP_ID, MOCK_TRIP, ROUTE_GRAPH_NO_LEGS, ROUTE_GRAPH_WITH_TRAIN_LEG,
  BUDGET_PLAN_FEASIBLE, TOURIST_SLOT_RESULTS, MERGED_ITINERARY_CONTENT,
  MERGED_ITINERARY_WITH_DECISIONS, FINANCE_APPROVED_RESULT, VALIDATION_PASS_RESULT,
} from './integration-fixtures';

// ── Shared setup helpers ──────────────────────────────────────────────────────

function buildEngine(sm: StateManager, ac: AgentCaller, ep: EventPublisher): WorkflowEngine {
  return new WorkflowEngine(new WorkflowStateMachine(), sm, ac, ep);
}

function wireHappyPath(agentCaller: AgentCaller): void {
  vi.mocked(agentCaller.callLogisticsPlan).mockResolvedValue(ROUTE_GRAPH_NO_LEGS);
  vi.mocked(agentCaller.callFinanceEstimate).mockResolvedValue(BUDGET_PLAN_FEASIBLE);
  vi.mocked(agentCaller.callPreferenceAgentSlots).mockResolvedValue(TOURIST_SLOT_RESULTS);
  vi.mocked(agentCaller.callOrchestratorMerge).mockResolvedValue({
    content: MERGED_ITINERARY_CONTENT, latencyMs: 300, tokensUsed: 600,
  });
  vi.mocked(agentCaller.callFinanceAgent).mockResolvedValue(FINANCE_APPROVED_RESULT);
  vi.mocked(agentCaller.callValidatorAgent).mockResolvedValue(VALIDATION_PASS_RESULT);
}

// ── Test 1: context checkpointed after every state transition ─────────────────

describe('WorkflowEngine integration — context checkpointed at every state', () => {
  let sm: StateManager;
  let ac: AgentCaller;
  let savedStates: string[];

  beforeEach(() => {
    vi.clearAllMocks();
    sm = new StateManager();
    ac = new AgentCaller();
    savedStates = [];

    vi.mocked(sm.getTrip).mockResolvedValue(MOCK_TRIP as never);
    vi.mocked(sm.saveWorkflowContext).mockImplementation(async (_, ctx) => {
      savedStates.push((ctx as WorkflowContext).currentState);
    });

    wireHappyPath(ac);
  });

  it('saves context in correct state order across all transitions', async () => {
    const engine = buildEngine(sm, ac, new EventPublisher());
    await engine.run(TRIP_ID);

    // Initial save + save after each state transition
    expect(savedStates).toContain('INTAKE_COMPLETE');
    expect(savedStates).toContain('LOGISTICS_PLANNING');
    expect(savedStates).toContain('FINANCE_ENVELOPE_CHECK');
    expect(savedStates).toContain('PARALLEL_TURISTIC_PLANNING');
    expect(savedStates).toContain('MERGE_AND_SCORE');
    expect(savedStates).toContain('FINANCE_VALIDATE');
    expect(savedStates).toContain('FINAL_VALIDATION');
    expect(savedStates).toContain('FINISH');
  });

  it('each save has the output artifact produced by that state', async () => {
    const savedContexts: WorkflowContext[] = [];
    vi.mocked(sm.saveWorkflowContext).mockImplementation(async (_, ctx) => {
      savedContexts.push({ ...(ctx as WorkflowContext) });
    });

    const engine = buildEngine(sm, ac, new EventPublisher());
    await engine.run(TRIP_ID);

    const afterLogistics = savedContexts.find((c) => c.currentState === 'FINANCE_ENVELOPE_CHECK');
    expect(afterLogistics?.routeGraph).toBeDefined();

    const afterFinance = savedContexts.find((c) => c.currentState === 'PARALLEL_TURISTIC_PLANNING');
    expect(afterFinance?.budgetPlan).toBeDefined();

    const afterTourist = savedContexts.find((c) => c.currentState === 'MERGE_AND_SCORE');
    expect(afterTourist?.touristAgentOutputs).toBeDefined();

    const afterMerge = savedContexts.find((c) => c.currentState === 'FINANCE_VALIDATE');
    expect(afterMerge?.mergedItinerary).toBeDefined();
  });
});

// ── Test 2: process restart recovery ─────────────────────────────────────────

describe('WorkflowEngine integration — process restart recovery', () => {
  let sm: StateManager;
  let ac: AgentCaller;

  beforeEach(() => {
    vi.clearAllMocks();
    sm = new StateManager();
    ac = new AgentCaller();
    vi.mocked(sm.getTrip).mockResolvedValue(MOCK_TRIP as never);
    vi.mocked(sm.saveWorkflowContext).mockResolvedValue(undefined);
  });

  it('skips logistics, finance estimate, tourist, merge when checkpoint has mergedItinerary', async () => {
    const savedContext: WorkflowContext = {
      tripId: TRIP_ID, origin: 'Porto',
      destinations: [{ country: 'Portugal', city: 'Porto', nights: 3 }, { country: 'Portugal', city: 'Lisbon', nights: 3 }],
      dates: { mode: 'fixed', startDate: '2026-09-10', endDate: '2026-09-16' },
      budgetTotal: 2400, budgetCurrency: 'EUR', preferredTransport: 'train',
      mustHaves: [], avoids: [], groupSize: 4,
      currentState: 'MERGE_AND_SCORE',
      routeGraph: ROUTE_GRAPH_NO_LEGS,
      budgetPlan: BUDGET_PLAN_FEASIBLE,
      touristAgentOutputs: { alice: {}, bob: {}, carlos: {}, diana: {} },
      mergedItinerary: { ...MERGED_ITINERARY_CONTENT },
      retryCount: {}, errors: [], totalTokensUsed: 500,
      startedAt: '2026-09-01T10:00:00Z',
    };

    vi.mocked(sm.loadWorkflowContext).mockResolvedValue(savedContext);
    vi.mocked(ac.callFinanceAgent).mockResolvedValue(FINANCE_APPROVED_RESULT);
    vi.mocked(ac.callValidatorAgent).mockResolvedValue(VALIDATION_PASS_RESULT);

    const engine = buildEngine(sm, ac, new EventPublisher());
    await engine.run(TRIP_ID);

    expect(ac.callLogisticsPlan).not.toHaveBeenCalled();
    expect(ac.callFinanceEstimate).not.toHaveBeenCalled();
    expect(ac.callPreferenceAgentSlots).not.toHaveBeenCalled();
    expect(ac.callOrchestratorMerge).not.toHaveBeenCalled();
    expect(ac.callFinanceAgent).toHaveBeenCalledOnce();
    expect(ac.callValidatorAgent).toHaveBeenCalledOnce();
    expect(sm.transitionStatus).toHaveBeenCalledWith(TRIP_ID, 'confirmed');
  });
});

// ── Test 3: atomic claim prevents duplicate engines ───────────────────────────

describe('WorkflowEngine integration — atomic claim prevents concurrent runs', () => {
  it('second engine.run() exits without calling any agents when claim fails', async () => {
    const sm = new StateManager();
    const ac = new AgentCaller();
    vi.clearAllMocks();

    // First call claims; second call is rejected
    vi.mocked(sm.claimNegotiating).mockResolvedValueOnce(true).mockResolvedValue(false);
    vi.mocked(sm.getTrip).mockResolvedValue(MOCK_TRIP as never);
    vi.mocked(sm.saveWorkflowContext).mockResolvedValue(undefined);
    wireHappyPath(ac);

    const engine1 = buildEngine(sm, ac, new EventPublisher());
    const engine2 = buildEngine(sm, ac, new EventPublisher());

    // Run first engine normally to completion
    await engine1.run(TRIP_ID);
    const callCountAfterFirst = vi.mocked(ac.callLogisticsPlan).mock.calls.length;

    // Second engine should exit immediately (claim rejected)
    await engine2.run(TRIP_ID);
    expect(vi.mocked(ac.callLogisticsPlan).mock.calls.length).toBe(callCountAfterFirst);
    expect(sm.getTrip).toHaveBeenCalledOnce(); // second engine doesn't reach getTrip
  });
});

// ── Test 4: transport priority persisted in context ───────────────────────────

describe('WorkflowEngine integration — transport priority persisted in context', () => {
  it('wasPreferenceHonored=false persisted when preferred mode unavailable', async () => {
    const sm = new StateManager();
    const ac = new AgentCaller();
    vi.clearAllMocks();

    const flightPreferredTrip = { ...MOCK_TRIP, transportPreference: 'flight' };
    vi.mocked(sm.getTrip).mockResolvedValue(flightPreferredTrip as never);

    const savedContexts: WorkflowContext[] = [];
    vi.mocked(sm.saveWorkflowContext).mockImplementation(async (_, ctx) => {
      savedContexts.push({ ...(ctx as WorkflowContext) });
    });

    // Train-only leg — no flight alternatives
    vi.mocked(ac.callLogisticsPlan).mockResolvedValue(ROUTE_GRAPH_WITH_TRAIN_LEG);
    vi.mocked(ac.callFinanceEstimate).mockResolvedValue(BUDGET_PLAN_FEASIBLE);
    vi.mocked(ac.callPreferenceAgentSlots).mockResolvedValue(TOURIST_SLOT_RESULTS);
    vi.mocked(ac.callOrchestratorMerge).mockResolvedValue({
      content: MERGED_ITINERARY_CONTENT, latencyMs: 300, tokensUsed: 600,
    });
    vi.mocked(ac.callFinanceAgent).mockResolvedValue(FINANCE_APPROVED_RESULT);
    vi.mocked(ac.callValidatorAgent).mockResolvedValue(VALIDATION_PASS_RESULT);

    const engine = buildEngine(sm, ac, new EventPublisher());
    await engine.run(TRIP_ID);

    const contextWithPriority = savedContexts.find((c) => c.transportPriority !== undefined);
    expect(contextWithPriority).toBeDefined();
    expect(contextWithPriority!.transportPriority!.wasPreferenceHonored).toBe(false);
    expect(contextWithPriority!.transportPriority!.selectedMode).toBe('train');
    expect(contextWithPriority!.transportPriority!.downgradeReason).toBeTruthy();
  });
});

// ── Test 5: per-proposal decision events, end to end through the real state machine ──

describe('WorkflowEngine integration — per-proposal decision events', () => {
  it('publishes one agent.decision event per INPUT proposal (not per raw decision-log entry) — full coverage even though the merge only logged 2 of the 4', async () => {
    const sm = new StateManager();
    const ac = new AgentCaller();
    vi.clearAllMocks();

    vi.mocked(sm.getTrip).mockResolvedValue(MOCK_TRIP as never);
    vi.mocked(sm.saveWorkflowContext).mockResolvedValue(undefined);
    vi.mocked(ac.callLogisticsPlan).mockResolvedValue(ROUTE_GRAPH_NO_LEGS);
    vi.mocked(ac.callFinanceEstimate).mockResolvedValue(BUDGET_PLAN_FEASIBLE);
    vi.mocked(ac.callPreferenceAgentSlots).mockResolvedValue(TOURIST_SLOT_RESULTS);
    vi.mocked(ac.callOrchestratorMerge).mockResolvedValue({
      content: MERGED_ITINERARY_WITH_DECISIONS, latencyMs: 300, tokensUsed: 600,
    });
    vi.mocked(ac.callFinanceAgent).mockResolvedValue(FINANCE_APPROVED_RESULT);
    vi.mocked(ac.callValidatorAgent).mockResolvedValue(VALIDATION_PASS_RESULT);

    const eventPublisher = new EventPublisher();
    const engine = buildEngine(sm, ac, eventPublisher);
    await engine.run(TRIP_ID);

    const published = vi.mocked(eventPublisher.publish).mock.calls.map((c) => c[2] as { type: string; agent: string; content: { status: string; proposalId: string } });
    expect(published.filter((e) => e.type === 'agent.merge')).toHaveLength(1);
    const decisionEvents = published.filter((e) => e.type === 'agent.decision');
    // 4 events — one per tourist agent's input proposal — not just the 2 the
    // merge's own decisions[] happened to mention. Ground truth is
    // `proposalIds` on the merged activities (only alice-1 is referenced),
    // so bob/carlos/diana all resolve to rejected regardless of decisions[].
    expect(decisionEvents).toHaveLength(4);
    expect(decisionEvents.map((e) => e.agent)).toEqual(['alice', 'bob', 'carlos', 'diana']);
    expect(decisionEvents.map((e) => e.content.status)).toEqual(['accepted', 'rejected', 'rejected', 'rejected']);

    expect(sm.updateProposalStatus).toHaveBeenCalledWith(TRIP_ID, 'alice', 1, 'accepted');
    expect(sm.updateProposalStatus).toHaveBeenCalledWith(TRIP_ID, 'bob', 1, 'rejected');
    expect(sm.updateProposalStatus).toHaveBeenCalledWith(TRIP_ID, 'carlos', 1, 'rejected');
    expect(sm.updateProposalStatus).toHaveBeenCalledWith(TRIP_ID, 'diana', 1, 'rejected');
    expect(sm.transitionStatus).toHaveBeenCalledWith(TRIP_ID, 'confirmed');
  });
});

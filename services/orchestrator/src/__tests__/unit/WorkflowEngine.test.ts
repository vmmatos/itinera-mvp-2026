import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@itinera/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@itinera/shared')>();
  return {
    ...actual,
    createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  };
});

vi.mock('@/config', () => ({
  config: {
    RABBITMQ_EXCHANGE: 'agent.events',
    PORT: 3001,
    JWT_SECRET: 'test-secret',
    PREFERENCE_AGENT_URL: 'http://pref:3002',
    ORCHESTRATOR_AGENT_URL: 'http://orch:3003',
    FINANCE_AGENT_URL: 'http://fin:3004',
    LOGISTICS_AGENT_URL: 'http://log:3005',
    VALIDATOR_URL: 'http://val:3006',
    JWT_ISSUER: 'itinera',
  },
  getRabbitMQUrl: () => 'amqp://localhost',
}));

vi.mock('@/services/StateManager');
vi.mock('@/services/AgentCaller');
vi.mock('@/services/EventPublisher');
vi.mock('@/services/WorkflowStateMachine');
vi.mock('@/services/TransportPriorityEngine', () => ({
  evaluateTransportPriority: vi.fn().mockReturnValue({
    selectedMode: 'flight',
    selectedOption: { mode: 'flight', durationMinutes: 120, priceEur: 80, warnings: [] },
    wasPreferenceHonored: true,
  }),
}));

import { WorkflowEngine } from '@/services/WorkflowEngine';
import { WorkflowStateMachine } from '@/services/WorkflowStateMachine';
import { StateManager } from '@/services/StateManager';
import { AgentCaller } from '@/services/AgentCaller';
import { EventPublisher } from '@/services/EventPublisher';
import { evaluateTransportPriority } from '@/services/TransportPriorityEngine';
import type { WorkflowContext, RouteGraph, BudgetPlan, TimeWindow } from '@itinera/shared';

const TRIP_ID = '550e8400-e29b-41d4-a716-446655440001';

const MOCK_TRIP = {
  id: TRIP_ID,
  name: 'Barcelona trip',
  status: 'draft',
  destinations: [{ country: 'Spain', city: 'Barcelona', nights: 3 }],
  budgetTotal: 1500,
  budgetCurrency: 'EUR',
  transportPreference: 'flight',
  dateInput: { mode: 'fixed' as const, startDate: '2026-08-10', endDate: '2026-08-13' },
  travellers: [{ id: 't1' }],
  region: 'Spain',
};

const ROUTE_GRAPH: RouteGraph = {
  orderedLegs: [],
  cityStays: [
    {
      city: 'Barcelona',
      country: 'Spain',
      arrivalDate: '2026-08-10',
      departureDate: '2026-08-13',
      nights: 3,
      timeWindows: [],
      sleepPoint: 'Eixample',
      budgetPerPersonPerNight: 80,
    },
  ],
  totalTransportCostEurPerPerson: 0,
  totalDurationDays: 3,
};

const BUDGET_PLAN: BudgetPlan = {
  perBlock: [
    {
      city: 'Barcelona',
      transportCostEurPerPerson: 0,
      accommodationBudgetEurPerPerson: 240,
      experiencesBudgetEurPerPerson: 1260,
      totalEurPerPerson: 1500,
    },
  ],
  totalEurPerPerson: 1500,
  grandTotal: 1500,
  feasible: true,
  bufferPct: 20,
  currency: 'EUR',
};

const MERGED_ITINERARY = {
  itinerary: [{ day: 1, city: 'Barcelona', activities: [] }],
  accommodation: [],
  _financeApproved: true,
  _budgetFeasible: true,
};

const TOURIST_OUTPUTS = { alice: {}, bob: {}, carlos: {}, diana: {} };

function makeContext(overrides: Partial<WorkflowContext> = {}): WorkflowContext {
  return {
    tripId: TRIP_ID,
    origin: 'Barcelona',
    destinations: [{ country: 'Spain', city: 'Barcelona', nights: 3 }],
    dates: { mode: 'fixed', startDate: '2026-08-10', endDate: '2026-08-13' },
    budgetTotal: 1500,
    budgetCurrency: 'EUR',
    preferredTransport: 'flight',
    pace: 'medium',
    mustHaves: [],
    avoids: [],
    groupSize: 1,
    currentState: 'INTAKE_COMPLETE',
    retryCount: {},
    errors: [],
    totalTokensUsed: 0,
    startedAt: '2026-08-01T10:00:00Z',
    ...overrides,
  };
}

type MockTransition = ReturnType<WorkflowStateMachine['transition']>;

function setupCommonMocks(sm: StateManager, ep: EventPublisher): void {
  vi.mocked(sm.claimNegotiating).mockResolvedValue(true);
  vi.mocked(sm.getTrip).mockResolvedValue(MOCK_TRIP as never);
  vi.mocked(sm.loadWorkflowContext).mockResolvedValue(null);
  vi.mocked(sm.saveWorkflowContext).mockResolvedValue();
  vi.mocked(sm.logAgentCall).mockResolvedValue();
  vi.mocked(sm.saveProposal).mockResolvedValue({} as never);
  vi.mocked(sm.updateProposalStatus).mockResolvedValue();
  vi.mocked(sm.saveFinalMetric).mockResolvedValue();
  vi.mocked(sm.transitionStatus).mockResolvedValue();
  vi.mocked(ep.publish).mockResolvedValue();
  vi.mocked(ep.publishToExchange).mockResolvedValue();
}

function driveStateMachine(sm: WorkflowStateMachine, transitions: MockTransition[]): void {
  let idx = 0;
  vi.mocked(sm.transition).mockImplementation(() => transitions[idx++]!);
  vi.mocked(sm.isTerminal).mockImplementation((s) => s === 'FINISH' || s === 'ASK_REFINEMENT');
}

let engine: WorkflowEngine;
let stateMachine: WorkflowStateMachine;
let stateManager: StateManager;
let agentCaller: AgentCaller;
let eventPublisher: EventPublisher;

beforeEach(() => {
  vi.clearAllMocks();
  stateMachine = new WorkflowStateMachine();
  stateManager = new StateManager();
  agentCaller = new AgentCaller();
  eventPublisher = new EventPublisher();
  engine = new WorkflowEngine(stateMachine, stateManager, agentCaller, eventPublisher);
});

describe('WorkflowEngine.run', () => {
  it('happy path: INTAKE_COMPLETE → FINISH calls all agents in correct order', async () => {
    setupCommonMocks(stateManager, eventPublisher);

    vi.mocked(agentCaller.callLogisticsPlan).mockResolvedValue(ROUTE_GRAPH);
    vi.mocked(agentCaller.callFinanceEstimate).mockResolvedValue(BUDGET_PLAN);
    vi.mocked(agentCaller.callPreferenceAgentSlots).mockResolvedValue([
      { content: {}, latencyMs: 100, tokensUsed: 50 },
      { content: {}, latencyMs: 100, tokensUsed: 50 },
      { content: {}, latencyMs: 100, tokensUsed: 50 },
      { content: {}, latencyMs: 100, tokensUsed: 50 },
    ]);
    vi.mocked(agentCaller.callOrchestratorMerge).mockResolvedValue({
      content: MERGED_ITINERARY,
      latencyMs: 200,
      tokensUsed: 200,
    });
    vi.mocked(agentCaller.callFinanceAgent).mockResolvedValue({
      content: { verdict: { approved: true, budgetFeasible: true, issues: [] } },
      latencyMs: 100,
      tokensUsed: 100,
    });
    vi.mocked(agentCaller.callValidatorAgent).mockResolvedValue({
      content: { scoring: { overallScore: 80 } },
      latencyMs: 50,
      tokensUsed: 50,
    });

    driveStateMachine(stateMachine, [
      { nextState: 'LOGISTICS_PLANNING', action: { type: 'CALL_LOGISTICS_PLAN' } },
      { nextState: 'FINANCE_ENVELOPE_CHECK', action: { type: 'CALL_FINANCE_ESTIMATE' } },
      { nextState: 'PARALLEL_TURISTIC_PLANNING', action: { type: 'CALL_TOURIST_AGENTS' } },
      { nextState: 'MERGE_AND_SCORE', action: { type: 'CALL_ORCHESTRATOR_MERGE' } },
      { nextState: 'FINANCE_VALIDATE', action: { type: 'CALL_FINANCE_VALIDATE' } },
      { nextState: 'FINAL_VALIDATION', action: { type: 'CALL_FINAL_VALIDATION' } },
      { nextState: 'FINISH', action: { type: 'FINISH' } },
    ]);

    await engine.run(TRIP_ID);

    expect(agentCaller.callLogisticsPlan).toHaveBeenCalledOnce();
    expect(agentCaller.callFinanceEstimate).toHaveBeenCalledOnce();
    expect(agentCaller.callPreferenceAgentSlots).toHaveBeenCalledOnce();
    expect(agentCaller.callOrchestratorMerge).toHaveBeenCalledOnce();
    expect(agentCaller.callFinanceAgent).toHaveBeenCalledOnce();
    expect(agentCaller.callValidatorAgent).toHaveBeenCalledOnce();
    expect(stateManager.transitionStatus).toHaveBeenCalledWith(TRIP_ID, 'confirmed');
    expect(stateManager.saveFinalMetric).toHaveBeenCalledOnce();
  });

  it('skips run if trip already claimed by another process', async () => {
    vi.mocked(stateManager.claimNegotiating).mockResolvedValue(false);

    await engine.run(TRIP_ID);

    expect(stateManager.getTrip).not.toHaveBeenCalled();
    expect(agentCaller.callLogisticsPlan).not.toHaveBeenCalled();
  });

  it('logistics local retry: calls logistics twice, downstream agents once each', async () => {
    setupCommonMocks(stateManager, eventPublisher);

    // Both logistics calls succeed; state machine drives retry mechanics
    vi.mocked(agentCaller.callLogisticsPlan).mockResolvedValue(ROUTE_GRAPH);
    vi.mocked(agentCaller.callFinanceEstimate).mockResolvedValue(BUDGET_PLAN);
    vi.mocked(agentCaller.callPreferenceAgentSlots).mockResolvedValue([
      { content: {}, latencyMs: 100, tokensUsed: 50 },
      { content: {}, latencyMs: 100, tokensUsed: 50 },
      { content: {}, latencyMs: 100, tokensUsed: 50 },
      { content: {}, latencyMs: 100, tokensUsed: 50 },
    ]);
    vi.mocked(agentCaller.callOrchestratorMerge).mockResolvedValue({
      content: MERGED_ITINERARY,
      latencyMs: 200,
      tokensUsed: 200,
    });
    vi.mocked(agentCaller.callFinanceAgent).mockResolvedValue({
      content: { verdict: { approved: true, budgetFeasible: true, issues: [] } },
      latencyMs: 100,
      tokensUsed: 100,
    });
    vi.mocked(agentCaller.callValidatorAgent).mockResolvedValue({
      content: { scoring: { overallScore: 80 } },
      latencyMs: 50,
      tokensUsed: 50,
    });

    // LOCAL_RETRY at index 1: engine increments counter AND calls executeAction inline (logistics #2)
    driveStateMachine(stateMachine, [
      { nextState: 'LOGISTICS_PLANNING', action: { type: 'CALL_LOGISTICS_PLAN' } },
      { nextState: 'LOGISTICS_PLANNING', action: { type: 'LOCAL_RETRY', retryTarget: 'logistics' } },
      { nextState: 'FINANCE_ENVELOPE_CHECK', action: { type: 'CALL_FINANCE_ESTIMATE' } },
      { nextState: 'PARALLEL_TURISTIC_PLANNING', action: { type: 'CALL_TOURIST_AGENTS' } },
      { nextState: 'MERGE_AND_SCORE', action: { type: 'CALL_ORCHESTRATOR_MERGE' } },
      { nextState: 'FINANCE_VALIDATE', action: { type: 'CALL_FINANCE_VALIDATE' } },
      { nextState: 'FINAL_VALIDATION', action: { type: 'CALL_FINAL_VALIDATION' } },
      { nextState: 'FINISH', action: { type: 'FINISH' } },
    ]);

    await engine.run(TRIP_ID);

    expect(agentCaller.callLogisticsPlan).toHaveBeenCalledTimes(2);
    expect(agentCaller.callFinanceEstimate).toHaveBeenCalledOnce();
    expect(agentCaller.callPreferenceAgentSlots).toHaveBeenCalledOnce();
  });

  it('early budget rejection: tourist agents and merge never called when finance estimate infeasible', async () => {
    setupCommonMocks(stateManager, eventPublisher);

    vi.mocked(agentCaller.callLogisticsPlan).mockResolvedValue(ROUTE_GRAPH);
    vi.mocked(agentCaller.callFinanceEstimate).mockResolvedValue({ ...BUDGET_PLAN, feasible: false });

    driveStateMachine(stateMachine, [
      { nextState: 'LOGISTICS_PLANNING', action: { type: 'CALL_LOGISTICS_PLAN' } },
      { nextState: 'FINANCE_ENVELOPE_CHECK', action: { type: 'CALL_FINANCE_ESTIMATE' } },
      { nextState: 'ASK_REFINEMENT', action: { type: 'ASK_REFINEMENT', reason: 'Budget infeasible before tourist planning' } },
    ]);

    await engine.run(TRIP_ID);

    expect(agentCaller.callPreferenceAgentSlots).not.toHaveBeenCalled();
    expect(agentCaller.callOrchestratorMerge).not.toHaveBeenCalled();
    expect(agentCaller.callFinanceAgent).not.toHaveBeenCalled();
  });

  it('process restart: restores saved context from DB, skips already-completed phases', async () => {
    // Simulate crash after merge completed: context was saved at MERGE_AND_SCORE with mergedItinerary
    const savedContext = makeContext({
      currentState: 'MERGE_AND_SCORE',
      routeGraph: ROUTE_GRAPH,
      budgetPlan: BUDGET_PLAN,
      touristAgentOutputs: TOURIST_OUTPUTS,
      mergedItinerary: MERGED_ITINERARY,
    });

    setupCommonMocks(stateManager, eventPublisher);
    vi.mocked(stateManager.loadWorkflowContext).mockResolvedValue(savedContext);

    vi.mocked(agentCaller.callFinanceAgent).mockResolvedValue({
      content: { verdict: { approved: true, budgetFeasible: true, issues: [] } },
      latencyMs: 100,
      tokensUsed: 100,
    });
    vi.mocked(agentCaller.callValidatorAgent).mockResolvedValue({
      content: { scoring: { overallScore: 75 } },
      latencyMs: 50,
      tokensUsed: 50,
    });

    // State machine resumes from MERGE_AND_SCORE → skips to FINANCE_VALIDATE → FINAL_VALIDATION → FINISH
    driveStateMachine(stateMachine, [
      { nextState: 'FINANCE_VALIDATE', action: { type: 'CALL_FINANCE_VALIDATE' } },
      { nextState: 'FINAL_VALIDATION', action: { type: 'CALL_FINAL_VALIDATION' } },
      { nextState: 'FINISH', action: { type: 'FINISH' } },
    ]);

    await engine.run(TRIP_ID);

    expect(agentCaller.callLogisticsPlan).not.toHaveBeenCalled();
    expect(agentCaller.callFinanceEstimate).not.toHaveBeenCalled();
    expect(agentCaller.callPreferenceAgentSlots).not.toHaveBeenCalled();
    expect(agentCaller.callOrchestratorMerge).not.toHaveBeenCalled();
    expect(agentCaller.callFinanceAgent).toHaveBeenCalledOnce();
    expect(agentCaller.callValidatorAgent).toHaveBeenCalledOnce();
    expect(stateManager.transitionStatus).toHaveBeenCalledWith(TRIP_ID, 'confirmed');
  });

  it('token count accumulates correctly across all LLM phases', async () => {
    setupCommonMocks(stateManager, eventPublisher);

    // Logistics and finance estimate use no LLM → add 0 tokens
    vi.mocked(agentCaller.callLogisticsPlan).mockResolvedValue(ROUTE_GRAPH);
    vi.mocked(agentCaller.callFinanceEstimate).mockResolvedValue(BUDGET_PLAN);
    // Tourist: 4 × 100 = 400
    vi.mocked(agentCaller.callPreferenceAgentSlots).mockResolvedValue([
      { content: {}, latencyMs: 100, tokensUsed: 100 },
      { content: {}, latencyMs: 100, tokensUsed: 100 },
      { content: {}, latencyMs: 100, tokensUsed: 100 },
      { content: {}, latencyMs: 100, tokensUsed: 100 },
    ]);
    // Merge: 300
    vi.mocked(agentCaller.callOrchestratorMerge).mockResolvedValue({
      content: MERGED_ITINERARY,
      latencyMs: 200,
      tokensUsed: 300,
    });
    // Finance validate: 150
    vi.mocked(agentCaller.callFinanceAgent).mockResolvedValue({
      content: { verdict: { approved: true, budgetFeasible: true, issues: [] } },
      latencyMs: 100,
      tokensUsed: 150,
    });
    // Final validation: 50
    vi.mocked(agentCaller.callValidatorAgent).mockResolvedValue({
      content: { scoring: { overallScore: 80 } },
      latencyMs: 50,
      tokensUsed: 50,
    });

    driveStateMachine(stateMachine, [
      { nextState: 'LOGISTICS_PLANNING', action: { type: 'CALL_LOGISTICS_PLAN' } },
      { nextState: 'FINANCE_ENVELOPE_CHECK', action: { type: 'CALL_FINANCE_ESTIMATE' } },
      { nextState: 'PARALLEL_TURISTIC_PLANNING', action: { type: 'CALL_TOURIST_AGENTS' } },
      { nextState: 'MERGE_AND_SCORE', action: { type: 'CALL_ORCHESTRATOR_MERGE' } },
      { nextState: 'FINANCE_VALIDATE', action: { type: 'CALL_FINANCE_VALIDATE' } },
      { nextState: 'FINAL_VALIDATION', action: { type: 'CALL_FINAL_VALIDATION' } },
      { nextState: 'FINISH', action: { type: 'FINISH' } },
    ]);

    await engine.run(TRIP_ID);

    // 400 (tourist) + 300 (merge) + 150 (finance) + 50 (validator) = 900
    expect(stateManager.saveFinalMetric).toHaveBeenCalledWith(
      expect.objectContaining({ totalTokensUsed: 900 }),
    );
  });
});

// ── Multi-city fixtures: Madrid (2 nights) → Dublin (2 nights) ──────────────
function windows(date: string, blocked: Partial<Record<'morning' | 'afternoon' | 'evening', TimeWindow['blockedReason']>>): TimeWindow[] {
  return (['morning', 'afternoon', 'evening'] as const).map((slot) => ({
    date,
    slot,
    durationMinutes: 120,
    isTransitDay: blocked[slot] !== undefined,
    ...(blocked[slot] !== undefined ? { blockedReason: blocked[slot] } : {}),
  }));
}

const TWO_CITY_TRIP = {
  ...MOCK_TRIP,
  name: 'Madrid + Dublin',
  destinations: [
    { country: 'Spain', city: 'Madrid', nights: 2 },
    { country: 'Ireland', city: 'Dublin', nights: 2 },
  ],
  transportPreference: 'car',
};

function twoCityRouteGraph(): RouteGraph {
  return {
    orderedLegs: [
      {
        from: 'Madrid',
        to: 'Dublin',
        departureDate: '2026-08-12',
        bestOption: { mode: 'flight', durationMinutes: 150, priceEur: 120, departureTime: '09:00', warnings: [] },
        alternatives: [{ mode: 'flight', durationMinutes: 180, priceEur: 95, warnings: [] }],
        totalCostEurPerPerson: 120,
      },
    ],
    cityStays: [
      {
        city: 'Madrid', country: 'Spain', arrivalDate: '2026-08-10', departureDate: '2026-08-12',
        nights: 2, timeWindows: [...windows('2026-08-10', {}), ...windows('2026-08-11', {})],
        sleepPoint: 'Centro', budgetPerPersonPerNight: 80,
      },
      {
        city: 'Dublin', country: 'Ireland', arrivalDate: '2026-08-12', departureDate: '2026-08-14',
        nights: 2,
        timeWindows: [
          ...windows('2026-08-12', { morning: 'inbound-transit' }),
          ...windows('2026-08-13', {}),
        ],
        sleepPoint: 'Temple Bar', budgetPerPersonPerNight: 90,
      },
    ],
    totalTransportCostEurPerPerson: 120,
    totalDurationDays: 4,
  };
}

// Per-city merge responses (Part B: one call per city stay, keyed by
// targetCity — see mockOrchestratorMergeByCity below). Split along the same
// city-ownership boundary the route graph already encodes: Madrid owns days
// 1-2, Dublin owns days 3-4.
const MADRID_CITY_MERGED = {
  accommodation: [],
  itinerary: [
    { day: 1, city: 'Madrid', country: 'Spain', activities: [{ time: 'morning', activity: 'Prado Museum' }] },
    { day: 2, city: 'Madrid', country: 'Spain', activities: [] },
  ],
  decisions: [],
  _financeApproved: true,
  _budgetFeasible: true,
};

const DUBLIN_CITY_MERGED = {
  accommodation: [],
  itinerary: [
    {
      day: 3, city: 'Dublin', country: 'Ireland',
      activities: [
        { time: 'morning', activity: 'In transit from Madrid' },
        { time: 'morning', activity: 'Guinness Storehouse tour' }, // LLM slip — blocked slot
        { time: 'afternoon', activity: 'Temple Bar walk' },
      ],
    },
    { day: 4, city: 'Dublin', country: 'Ireland', activities: [] },
  ],
  decisions: [],
  _financeApproved: true,
  _budgetFeasible: true,
};

// Combined shape, kept for any assertion that still wants "the whole trip" —
// equivalent to what WorkflowEngine now assembles from the two per-city calls.
const TWO_CITY_MERGED = {
  accommodation: [...MADRID_CITY_MERGED.accommodation, ...DUBLIN_CITY_MERGED.accommodation],
  itinerary: [...MADRID_CITY_MERGED.itinerary, ...DUBLIN_CITY_MERGED.itinerary],
  _financeApproved: true,
  _budgetFeasible: true,
};

/** Mocks callOrchestratorMerge to return a different per-city fixture keyed
 * by the real `targetCity` argument (7th param) — mirrors the real Part-B
 * call pattern (one call per city stay) instead of one call returning the
 * whole trip regardless of which city was asked for. */
function mockOrchestratorMergeByCity(byCity: Record<string, Record<string, unknown>>): void {
  vi.mocked(agentCaller.callOrchestratorMerge).mockImplementation(async (..._args) => {
    const targetCity = _args[6] as string;
    const content = byCity[targetCity];
    return { content: JSON.parse(JSON.stringify(content ?? {})), latencyMs: 200, tokensUsed: 200 };
  });
}

function driveHappyPath(): void {
  driveStateMachine(stateMachine, [
    { nextState: 'LOGISTICS_PLANNING', action: { type: 'CALL_LOGISTICS_PLAN' } },
    { nextState: 'FINANCE_ENVELOPE_CHECK', action: { type: 'CALL_FINANCE_ESTIMATE' } },
    { nextState: 'PARALLEL_TURISTIC_PLANNING', action: { type: 'CALL_TOURIST_AGENTS' } },
    { nextState: 'MERGE_AND_SCORE', action: { type: 'CALL_ORCHESTRATOR_MERGE' } },
    { nextState: 'FINANCE_VALIDATE', action: { type: 'CALL_FINANCE_VALIDATE' } },
    { nextState: 'FINAL_VALIDATION', action: { type: 'CALL_FINAL_VALIDATION' } },
    { nextState: 'FINISH', action: { type: 'FINISH' } },
  ]);
}

function setupTwoCityMocks(): void {
  setupCommonMocks(stateManager, eventPublisher);
  vi.mocked(stateManager.getTrip).mockResolvedValue(TWO_CITY_TRIP as never);
  vi.mocked(agentCaller.callLogisticsPlan).mockResolvedValue(twoCityRouteGraph());
  vi.mocked(agentCaller.callFinanceEstimate).mockResolvedValue(BUDGET_PLAN);
  vi.mocked(agentCaller.callPreferenceAgentSlots).mockResolvedValue([
    { content: {}, latencyMs: 100, tokensUsed: 50 },
    { content: {}, latencyMs: 100, tokensUsed: 50 },
    { content: {}, latencyMs: 100, tokensUsed: 50 },
    { content: {}, latencyMs: 100, tokensUsed: 50 },
  ]);
  mockOrchestratorMergeByCity({ Madrid: MADRID_CITY_MERGED, Dublin: DUBLIN_CITY_MERGED });
  vi.mocked(agentCaller.callFinanceAgent).mockResolvedValue({
    content: { verdict: { approved: true, budgetFeasible: true, issues: [] } },
    latencyMs: 100,
    tokensUsed: 100,
  });
  vi.mocked(agentCaller.callValidatorAgent).mockResolvedValue({
    content: { scoring: { overallScore: 80 } },
    latencyMs: 50,
    tokensUsed: 50,
  });
}

function mergedProposalContent(): Record<string, unknown> {
  const call = vi.mocked(stateManager.saveProposal).mock.calls.find(
    (c) => (c[0] as { agent: string }).agent === 'orchestrator',
  );
  expect(call).toBeDefined();
  return (call![0] as { content: Record<string, unknown> }).content;
}

describe('WorkflowEngine — blocked-slot guard (G: no activities during travel)', () => {
  it('strips LLM tourist activities from routeGraph-blocked slots, keeping transit placeholders', async () => {
    setupTwoCityMocks();
    driveHappyPath();

    await engine.run(TRIP_ID);

    const itinerary = mergedProposalContent()['itinerary'] as Array<Record<string, unknown>>;
    const day3 = itinerary.find((d) => d['day'] === 3)!;
    const acts = (day3['activities'] as Array<Record<string, unknown>>).map((a) => a['activity']);
    expect(acts).toContain('In transit from Madrid');
    expect(acts).not.toContain('Guinness Storehouse tour'); // blocked morning slot
    expect(acts).toContain('Temple Bar walk'); // free afternoon slot untouched
  });
});

describe('WorkflowEngine — late-departure travel day belongs to the origin city', () => {
  // Madrid → Dublin on a 21:35 flight landing 00:20: the routeGraph attributes
  // the travel date to Madrid (free morning/afternoon + outbound evening);
  // Dublin's windows start the following day with a recovery morning.
  function lateDepartureRouteGraph(): RouteGraph {
    return {
      orderedLegs: [
        {
          from: 'Madrid',
          to: 'Dublin',
          departureDate: '2026-08-12',
          bestOption: { mode: 'flight', durationMinutes: 165, priceEur: 58, departureTime: '21:35', arrivalTime: '00:20', warnings: [] },
          alternatives: [{ mode: 'flight', durationMinutes: 180, priceEur: 95, warnings: [] }],
          totalCostEurPerPerson: 58,
        },
      ],
      cityStays: [
        {
          city: 'Madrid', country: 'Spain', arrivalDate: '2026-08-10', departureDate: '2026-08-12',
          nights: 2,
          timeWindows: [
            ...windows('2026-08-10', {}),
            ...windows('2026-08-11', {}),
            // Travel date gained by the origin: evening is the journey.
            ...windows('2026-08-12', { evening: 'outbound-transit' }),
          ],
          sleepPoint: 'Centro', budgetPerPersonPerNight: 80,
        },
        {
          city: 'Dublin', country: 'Ireland', arrivalDate: '2026-08-12', departureDate: '2026-08-14',
          nights: 2,
          // No windows on the travel date; first day is the 13th, recovery morning.
          timeWindows: [...windows('2026-08-13', { morning: 'inbound-recovery' })],
          sleepPoint: 'Temple Bar', budgetPerPersonPerNight: 90,
        },
      ],
      totalTransportCostEurPerPerson: 58,
      totalDurationDays: 4,
    };
  }

  // Madrid owns the travel day (day 3) per its own timeWindows even though
  // the LLM drift-mislabels it 'Dublin' — this is exactly what the Madrid-
  // targeted per-city call returns; Dublin's own call only covers day 4.
  const LATE_DEP_MADRID = {
    accommodation: [],
    itinerary: [
      { day: 1, city: 'Madrid', country: 'Spain', activities: [] },
      { day: 2, city: 'Madrid', country: 'Spain', activities: [] },
      {
        // LLM drift: labels the travel day as Dublin and slips a tourist
        // activity into the blocked evening slot.
        day: 3, city: 'Dublin', country: 'Ireland',
        activities: [
          { time: 'morning', activity: 'Prado Museum visit' },
          { time: 'evening', activity: 'Check out and depart to Dublin' },
          { time: 'evening', activity: 'Guinness Storehouse tour' },
        ],
      },
    ],
    decisions: [],
    _financeApproved: true,
    _budgetFeasible: true,
  };

  const LATE_DEP_DUBLIN = {
    accommodation: [],
    itinerary: [
      { day: 4, city: 'Dublin', country: 'Ireland', activities: [
        { time: 'morning', activity: 'Check in and rest' },
      ] },
    ],
    decisions: [],
    _financeApproved: true,
    _budgetFeasible: true,
  };

  it('labels the travel day with the ORIGIN city, keeps its daytime activities, strips the evening slip, stamps transport there', async () => {
    setupTwoCityMocks();
    vi.mocked(agentCaller.callLogisticsPlan).mockResolvedValue(lateDepartureRouteGraph());
    mockOrchestratorMergeByCity({ Madrid: LATE_DEP_MADRID, Dublin: LATE_DEP_DUBLIN });
    driveHappyPath();

    await engine.run(TRIP_ID);

    const itinerary = mergedProposalContent()['itinerary'] as Array<Record<string, unknown>>;
    const day3 = itinerary.find((d) => d['day'] === 3)!;

    // Ownership: travel day = Madrid (origin), not Dublin.
    expect(day3['city']).toBe('Madrid');

    const acts = (day3['activities'] as Array<Record<string, unknown>>);
    const names = acts.map((a) => a['activity']);
    expect(names).toContain('Prado Museum visit'); // free morning in the origin
    expect(names).toContain('Check out and depart to Dublin'); // transit placeholder kept
    expect(names).not.toContain('Guinness Storehouse tour'); // blocked evening slip removed

    // Transport + cityTransition stamped on the travel day itself.
    const transport = (day3['transport'] as Array<Record<string, unknown>>)[0];
    expect(transport).toMatchObject({ mode: 'flight', departureTime: '21:35' });
    expect(day3['cityTransition']).toMatchObject({ to: 'Dublin' });

    // Next day stays Dublin with its recovery morning intact.
    const day4 = itinerary.find((d) => d['day'] === 4)!;
    expect(day4['city']).toBe('Dublin');
    expect((day4['activities'] as Array<Record<string, unknown>>)[0]).toMatchObject({ activity: 'Check in and rest' });
  });
});

describe('WorkflowEngine — duplicate transit-day dedupe (G: one card per calendar day)', () => {
  // Same routeGraph as the late-departure case above: day 3 is owned by
  // Madrid (origin) per timeWindows. Here BOTH per-city LLM calls hallucinate
  // a day-3 entry — Madrid correctly (it owns it), Dublin incorrectly (its
  // own timeWindows never mention 2026-08-12 at all). merge.txt tells the
  // LLM to stay in its lane, but that's prompt-level only; this asserts the
  // deterministic backstop (filterOwnedDays) drops Dublin's copy.
  function lateDepartureRouteGraph(): RouteGraph {
    return {
      orderedLegs: [
        {
          from: 'Madrid',
          to: 'Dublin',
          departureDate: '2026-08-12',
          bestOption: { mode: 'flight', durationMinutes: 165, priceEur: 58, departureTime: '21:35', arrivalTime: '00:20', warnings: [] },
          alternatives: [{ mode: 'flight', durationMinutes: 180, priceEur: 95, warnings: [] }],
          totalCostEurPerPerson: 58,
        },
      ],
      cityStays: [
        {
          city: 'Madrid', country: 'Spain', arrivalDate: '2026-08-10', departureDate: '2026-08-12',
          nights: 2,
          timeWindows: [
            ...windows('2026-08-10', {}),
            ...windows('2026-08-11', {}),
            ...windows('2026-08-12', { evening: 'outbound-transit' }),
          ],
          sleepPoint: 'Centro', budgetPerPersonPerNight: 80,
        },
        {
          city: 'Dublin', country: 'Ireland', arrivalDate: '2026-08-12', departureDate: '2026-08-14',
          nights: 2,
          // No windows on 2026-08-12 — Dublin does not own the travel date.
          timeWindows: [...windows('2026-08-13', { morning: 'inbound-recovery' })],
          sleepPoint: 'Temple Bar', budgetPerPersonPerNight: 90,
        },
      ],
      totalTransportCostEurPerPerson: 58,
      totalDurationDays: 4,
    };
  }

  const DUP_DAY_MADRID = {
    accommodation: [],
    itinerary: [
      { day: 1, city: 'Madrid', country: 'Spain', activities: [] },
      { day: 2, city: 'Madrid', country: 'Spain', activities: [] },
      {
        day: 3, city: 'Madrid', country: 'Spain',
        activities: [
          { time: 'morning', activity: 'Prado Museum visit' },
          { time: 'evening', activity: 'Check out and depart to Dublin' },
        ],
      },
    ],
    decisions: [],
    _financeApproved: true,
    _budgetFeasible: true,
  };

  // Dublin's own call hallucinates day 3 too — outside its own timeWindows,
  // this is exactly the "second Day N card" bug reported against the PDF.
  const DUP_DAY_DUBLIN = {
    accommodation: [],
    itinerary: [
      {
        day: 3, city: 'Dublin', country: 'Ireland',
        activities: [
          { time: 'morning', activity: 'In transit from Madrid' },
          { time: 'afternoon', activity: 'Introductory walk through Trinity College' },
          { time: 'evening', activity: 'Traditional Irish music session' },
        ],
      },
      { day: 4, city: 'Dublin', country: 'Ireland', activities: [
        { time: 'morning', activity: 'Check in and rest' },
      ] },
    ],
    decisions: [],
    _financeApproved: true,
    _budgetFeasible: true,
  };

  it('keeps only the owning city\'s day-3 entry when both per-city calls return it', async () => {
    setupTwoCityMocks();
    vi.mocked(agentCaller.callLogisticsPlan).mockResolvedValue(lateDepartureRouteGraph());
    mockOrchestratorMergeByCity({ Madrid: DUP_DAY_MADRID, Dublin: DUP_DAY_DUBLIN });
    driveHappyPath();

    await engine.run(TRIP_ID);

    const itinerary = mergedProposalContent()['itinerary'] as Array<Record<string, unknown>>;
    const day3Entries = itinerary.filter((d) => d['day'] === 3);

    expect(day3Entries).toHaveLength(1);
    expect(day3Entries[0]?.['city']).toBe('Madrid');
    const names = (day3Entries[0]?.['activities'] as Array<Record<string, unknown>>).map((a) => a['activity']);
    expect(names).toContain('Prado Museum visit');
    expect(names).not.toContain('Introductory walk through Trinity College');

    // Day 4 (uniquely Dublin's) is untouched by the filter.
    const day4 = itinerary.find((d) => d['day'] === 4)!;
    expect(day4['city']).toBe('Dublin');
  });

  it('does not drop legitimate days when routeGraph ownership has no overlap (regression)', async () => {
    setupTwoCityMocks();
    driveHappyPath();

    await engine.run(TRIP_ID);

    const itinerary = mergedProposalContent()['itinerary'] as Array<Record<string, unknown>>;
    expect(itinerary.map((d) => d['day']).sort()).toEqual([1, 2, 3, 4]);
  });
});

describe('WorkflowEngine — per-leg transport priority', () => {
  it('stores per-leg results in context and surfaces the downgrade reason in the injected transport warnings', async () => {
    setupTwoCityMocks();
    vi.mocked(evaluateTransportPriority).mockReturnValue({
      selectedMode: 'flight',
      selectedOption: { mode: 'flight', durationMinutes: 150, priceEur: 120, warnings: [] },
      wasPreferenceHonored: false,
      downgradeReason: 'No car offers found for this leg',
    });
    driveHappyPath();

    await engine.run(TRIP_ID);

    // Downgrade reason lands on the transit day's transport entry (day 3).
    const itinerary = mergedProposalContent()['itinerary'] as Array<Record<string, unknown>>;
    const day3 = itinerary.find((d) => d['day'] === 3)!;
    const transport = (day3['transport'] as Array<Record<string, unknown>>)[0];
    expect((transport['warnings'] as string[]).some((w) => w.includes('No car offers found'))).toBe(true);
    expect((transport['alternatives'] as unknown[]).length).toBeGreaterThan(0);

    // Per-leg results persisted in the workflow context.
    const contexts = vi.mocked(stateManager.saveWorkflowContext).mock.calls.map((c) => c[1] as WorkflowContext);
    const withPriorities = contexts.find((c) => c.transportPriorities !== undefined);
    expect(withPriorities).toBeDefined();
    expect(withPriorities!.transportPriorities).toHaveLength(1);
    expect(withPriorities!.transportPriorities![0]!.wasPreferenceHonored).toBe(false);
  });
});

describe('WorkflowEngine — local restriction warnings (#76)', () => {
  it('attaches restrictionWarnings from callLogisticsRestrictions onto the saved merge proposal', async () => {
    setupCommonMocks(stateManager, eventPublisher);
    vi.mocked(agentCaller.callLogisticsPlan).mockResolvedValue(ROUTE_GRAPH);
    vi.mocked(agentCaller.callFinanceEstimate).mockResolvedValue(BUDGET_PLAN);
    vi.mocked(agentCaller.callPreferenceAgentSlots).mockResolvedValue([
      { content: {}, latencyMs: 100, tokensUsed: 50 },
      { content: {}, latencyMs: 100, tokensUsed: 50 },
      { content: {}, latencyMs: 100, tokensUsed: 50 },
      { content: {}, latencyMs: 100, tokensUsed: 50 },
    ]);
    vi.mocked(agentCaller.callOrchestratorMerge).mockResolvedValue({
      content: JSON.parse(JSON.stringify(MERGED_ITINERARY)) as Record<string, unknown>,
      latencyMs: 200,
      tokensUsed: 200,
    });
    vi.mocked(agentCaller.callFinanceAgent).mockResolvedValue({
      content: { verdict: { approved: true, budgetFeasible: true, issues: [] } },
      latencyMs: 100,
      tokensUsed: 100,
    });
    vi.mocked(agentCaller.callValidatorAgent).mockResolvedValue({
      content: { scoring: { overallScore: 80 } },
      latencyMs: 50,
      tokensUsed: 50,
    });
    const warnings = [
      { day: 1, activityName: 'Jerónimos Monastery', warningType: 'public_holiday' as const, message: '⚠ closed for Portugal Day' },
    ];
    vi.mocked(agentCaller.callLogisticsRestrictions).mockResolvedValue(warnings);
    driveHappyPath();

    await engine.run(TRIP_ID);

    expect(agentCaller.callLogisticsRestrictions).toHaveBeenCalledWith(
      TRIP_ID, MERGED_ITINERARY.itinerary, MOCK_TRIP.region, expect.objectContaining({ mode: 'fixed' }),
    );
    expect(mergedProposalContent()['restrictionWarnings']).toEqual(warnings);
    expect(stateManager.logAgentCall).toHaveBeenCalledWith(
      expect.objectContaining({ agent: 'logistics', action: 'restrictions' }),
    );
  });

  it('does not block the merge or trip confirmation when the restriction check fails', async () => {
    setupCommonMocks(stateManager, eventPublisher);
    vi.mocked(agentCaller.callLogisticsPlan).mockResolvedValue(ROUTE_GRAPH);
    vi.mocked(agentCaller.callFinanceEstimate).mockResolvedValue(BUDGET_PLAN);
    vi.mocked(agentCaller.callPreferenceAgentSlots).mockResolvedValue([
      { content: {}, latencyMs: 100, tokensUsed: 50 },
      { content: {}, latencyMs: 100, tokensUsed: 50 },
      { content: {}, latencyMs: 100, tokensUsed: 50 },
      { content: {}, latencyMs: 100, tokensUsed: 50 },
    ]);
    vi.mocked(agentCaller.callOrchestratorMerge).mockResolvedValue({
      content: JSON.parse(JSON.stringify(MERGED_ITINERARY)) as Record<string, unknown>,
      latencyMs: 200,
      tokensUsed: 200,
    });
    vi.mocked(agentCaller.callFinanceAgent).mockResolvedValue({
      content: { verdict: { approved: true, budgetFeasible: true, issues: [] } },
      latencyMs: 100,
      tokensUsed: 100,
    });
    vi.mocked(agentCaller.callValidatorAgent).mockResolvedValue({
      content: { scoring: { overallScore: 80 } },
      latencyMs: 50,
      tokensUsed: 50,
    });
    vi.mocked(agentCaller.callLogisticsRestrictions).mockRejectedValue(new Error('logistics-agent unreachable'));
    driveHappyPath();

    await engine.run(TRIP_ID);

    expect(mergedProposalContent()['restrictionWarnings']).toEqual([]);
    expect(stateManager.transitionStatus).toHaveBeenCalledWith(TRIP_ID, 'confirmed');
  });
});

describe('WorkflowEngine — weather assessment (not-show-meteo)', () => {
  it('attaches weatherAssessment from callLogisticsWeatherAssessment onto the saved merge proposal', async () => {
    setupCommonMocks(stateManager, eventPublisher);
    vi.mocked(agentCaller.callLogisticsPlan).mockResolvedValue(ROUTE_GRAPH);
    vi.mocked(agentCaller.callFinanceEstimate).mockResolvedValue(BUDGET_PLAN);
    vi.mocked(agentCaller.callPreferenceAgentSlots).mockResolvedValue([
      { content: {}, latencyMs: 100, tokensUsed: 50 },
      { content: {}, latencyMs: 100, tokensUsed: 50 },
      { content: {}, latencyMs: 100, tokensUsed: 50 },
      { content: {}, latencyMs: 100, tokensUsed: 50 },
    ]);
    vi.mocked(agentCaller.callOrchestratorMerge).mockResolvedValue({
      content: JSON.parse(JSON.stringify(MERGED_ITINERARY)) as Record<string, unknown>,
      latencyMs: 200,
      tokensUsed: 200,
    });
    vi.mocked(agentCaller.callFinanceAgent).mockResolvedValue({
      content: { verdict: { approved: true, budgetFeasible: true, issues: [] } },
      latencyMs: 100,
      tokensUsed: 100,
    });
    vi.mocked(agentCaller.callValidatorAgent).mockResolvedValue({
      content: { scoring: { overallScore: 80 } },
      latencyMs: 50,
      tokensUsed: 50,
    });
    vi.mocked(agentCaller.callLogisticsRestrictions).mockResolvedValue([]);
    const assessment = {
      overallRisk: 'medium',
      dayAssessments: [{ day: 1, date: '2026-08-10', weatherRisk: 'medium', affectedActivities: [] }],
      timingIssues: [],
      summary: 'Rain expected on day 1.',
    };
    vi.mocked(agentCaller.callLogisticsWeatherAssessment).mockResolvedValue({
      content: assessment,
      latencyMs: 300,
      tokensUsed: 400,
    });
    driveHappyPath();

    await engine.run(TRIP_ID);

    expect(agentCaller.callLogisticsWeatherAssessment).toHaveBeenCalledWith(
      TRIP_ID, 1, MERGED_ITINERARY.itinerary, MOCK_TRIP.region, expect.objectContaining({ mode: 'fixed' }), [],
    );
    expect(mergedProposalContent()['weatherAssessment']).toEqual(assessment);
    expect(stateManager.logAgentCall).toHaveBeenCalledWith(
      expect.objectContaining({ agent: 'logistics', action: 'weather-assessment', tokensUsed: 400 }),
    );
  });

  it('does not block the merge or trip confirmation when the weather assessment call fails', async () => {
    setupCommonMocks(stateManager, eventPublisher);
    vi.mocked(agentCaller.callLogisticsPlan).mockResolvedValue(ROUTE_GRAPH);
    vi.mocked(agentCaller.callFinanceEstimate).mockResolvedValue(BUDGET_PLAN);
    vi.mocked(agentCaller.callPreferenceAgentSlots).mockResolvedValue([
      { content: {}, latencyMs: 100, tokensUsed: 50 },
      { content: {}, latencyMs: 100, tokensUsed: 50 },
      { content: {}, latencyMs: 100, tokensUsed: 50 },
      { content: {}, latencyMs: 100, tokensUsed: 50 },
    ]);
    vi.mocked(agentCaller.callOrchestratorMerge).mockResolvedValue({
      content: JSON.parse(JSON.stringify(MERGED_ITINERARY)) as Record<string, unknown>,
      latencyMs: 200,
      tokensUsed: 200,
    });
    vi.mocked(agentCaller.callFinanceAgent).mockResolvedValue({
      content: { verdict: { approved: true, budgetFeasible: true, issues: [] } },
      latencyMs: 100,
      tokensUsed: 100,
    });
    vi.mocked(agentCaller.callValidatorAgent).mockResolvedValue({
      content: { scoring: { overallScore: 80 } },
      latencyMs: 50,
      tokensUsed: 50,
    });
    vi.mocked(agentCaller.callLogisticsRestrictions).mockResolvedValue([]);
    vi.mocked(agentCaller.callLogisticsWeatherAssessment).mockRejectedValue(new Error('logistics-agent unreachable'));
    driveHappyPath();

    await engine.run(TRIP_ID);

    expect(mergedProposalContent()['weatherAssessment']).toEqual({});
    expect(stateManager.transitionStatus).toHaveBeenCalledWith(TRIP_ID, 'confirmed');
  });
});

describe('WorkflowEngine — per-proposal decision events (derived from proposalIds)', () => {
  // Real proposal ids (assigned by preference-agent code, not the LLM) — the
  // authoritative key. Diana proposes nothing this round, on purpose, to
  // prove an agent with zero proposals is simply skipped, not an error.
  const ALICE_PROPOSAL = { id: 'alice-1', city: 'Barcelona', date: '2026-08-10', slot: 'morning', activity: 'Mercat de Sta Caterina', venue: 'Mercat de Sta Caterina', estimatedCostPerPerson: 14 };
  const BOB_PROPOSAL = { id: 'bob-1', city: 'Barcelona', date: '2026-08-10', slot: 'evening', activity: 'Razzmatazz', venue: 'Razzmatazz', estimatedCostPerPerson: 30 };
  const CARLOS_PROPOSAL = { id: 'carlos-1', city: 'Barcelona', date: '2026-08-10', slot: 'morning', activity: 'Collserola trail run', venue: 'Collserola', estimatedCostPerPerson: 0 };

  // The merge response: alice's activity used as-is (accepted), carlos's idea
  // reshaped into a different activity (merged — decisions[] supplies the
  // reason text), bob's never referenced anywhere (rejected). Ground truth
  // for status comes from `proposalIds` on the activities, NOT from
  // `decisions[]` — decisions[] here only supplies carlos's reason text, and
  // deliberately omits alice/bob to prove the default reason text kicks in.
  const MERGED_WITH_PROPOSAL_IDS = {
    accommodation: [],
    itinerary: [{
      day: 1, city: 'Barcelona', country: 'Spain',
      activities: [
        { time: 'morning', activity: 'Mercat de Sta Caterina', proposalIds: ['alice-1'] },
        { time: 'afternoon', activity: 'Collserola guided hike', proposalIds: ['carlos-1'] },
      ],
    }],
    decisions: [
      { proposalId: 'carlos-1', agent: 'carlos', city: 'Barcelona', date: '2026-08-10', slot: 'morning', activity: 'Collserola trail run', status: 'merged', reason: 'combined with a local guide add-on' },
    ],
    _financeApproved: true,
    _budgetFeasible: true,
  };

  function setupWithProposals(mergedContent: Record<string, unknown>): void {
    setupCommonMocks(stateManager, eventPublisher);
    vi.mocked(agentCaller.callLogisticsPlan).mockResolvedValue(ROUTE_GRAPH);
    vi.mocked(agentCaller.callFinanceEstimate).mockResolvedValue(BUDGET_PLAN);
    vi.mocked(agentCaller.callPreferenceAgentSlots).mockResolvedValue([
      { content: { slotProposals: [ALICE_PROPOSAL] }, latencyMs: 100, tokensUsed: 50 },
      { content: { slotProposals: [BOB_PROPOSAL] }, latencyMs: 100, tokensUsed: 50 },
      { content: { slotProposals: [CARLOS_PROPOSAL] }, latencyMs: 100, tokensUsed: 50 },
      { content: { slotProposals: [] }, latencyMs: 100, tokensUsed: 50 },
    ]);
    vi.mocked(agentCaller.callOrchestratorMerge).mockResolvedValue({
      content: JSON.parse(JSON.stringify(mergedContent)) as Record<string, unknown>,
      latencyMs: 200,
      tokensUsed: 200,
    });
    vi.mocked(agentCaller.callFinanceAgent).mockResolvedValue({
      content: { verdict: { approved: true, budgetFeasible: true, issues: [] } },
      latencyMs: 100,
      tokensUsed: 100,
    });
    vi.mocked(agentCaller.callValidatorAgent).mockResolvedValue({
      content: { scoring: { overallScore: 80 } },
      latencyMs: 50,
      tokensUsed: 50,
    });
    vi.mocked(agentCaller.callLogisticsRestrictions).mockResolvedValue([]);
    vi.mocked(agentCaller.callLogisticsWeatherAssessment).mockResolvedValue({ content: {}, latencyMs: 0, tokensUsed: 0 });
  }

  it('saves a proposal row for each of the 4 tourist agents during PARALLEL_TURISTIC_PLANNING', async () => {
    setupWithProposals(MERGED_WITH_PROPOSAL_IDS);
    driveHappyPath();

    await engine.run(TRIP_ID);

    const touristAgents = ['alice', 'bob', 'carlos', 'diana'];
    for (const agent of touristAgents) {
      expect(stateManager.saveProposal).toHaveBeenCalledWith(
        expect.objectContaining({ tripId: TRIP_ID, agent, round: 1, action: 'propose' }),
      );
    }
  });

  it('happy path: derives accepted/merged/rejected from which proposalIds ended up in the final itinerary, not from the merge LLM\'s own decisions log', async () => {
    setupWithProposals(MERGED_WITH_PROPOSAL_IDS);
    driveHappyPath();

    await engine.run(TRIP_ID);

    const decisionCalls = vi.mocked(eventPublisher.publish).mock.calls.filter(
      (c) => (c[2] as { type: string }).type === 'agent.decision',
    );
    expect(decisionCalls).toHaveLength(3);
    const byAgent = new Map(decisionCalls.map((c) => {
      const content = (c[2] as { content: Record<string, unknown> }).content;
      return [content['agent'] as string, content];
    }));

    expect(byAgent.get('alice')).toMatchObject({ proposalId: 'alice-1', status: 'accepted', reason: 'Included in the final itinerary.' });
    expect(byAgent.get('carlos')).toMatchObject({ proposalId: 'carlos-1', status: 'merged', reason: 'combined with a local guide add-on' });
    expect(byAgent.get('bob')).toMatchObject({
      proposalId: 'bob-1',
      status: 'rejected',
      reason: 'Not included in the final itinerary — budget, duplicate, or a competing proposal was preferred for that slot.',
    });
  });

  it('rolls per-decision status up into one updateProposalStatus call per agent', async () => {
    setupWithProposals(MERGED_WITH_PROPOSAL_IDS);
    driveHappyPath();

    await engine.run(TRIP_ID);

    expect(stateManager.updateProposalStatus).toHaveBeenCalledWith(TRIP_ID, 'alice', 1, 'accepted');
    expect(stateManager.updateProposalStatus).toHaveBeenCalledWith(TRIP_ID, 'bob', 1, 'rejected');
    expect(stateManager.updateProposalStatus).toHaveBeenCalledWith(TRIP_ID, 'carlos', 1, 'merged');
    expect(stateManager.updateProposalStatus).toHaveBeenCalledTimes(3);
  });

  it('error: a malformed/missing decisions log never silently drops proposals — every one still resolves (safe default: rejected)', async () => {
    // No `proposalIds` on any activity and no `decisions` at all — simulates
    // the merge LLM's decision log failing schema validation (the old
    // `.catch([])` case) or simply never tagging activities. The bug this
    // fix targets: this used to mean zero agent.decision events published,
    // leaving every proposal card stuck "awaiting orchestrator" forever.
    setupWithProposals(MERGED_ITINERARY);
    driveHappyPath();

    await expect(engine.run(TRIP_ID)).resolves.not.toThrow();

    const decisionCalls = vi.mocked(eventPublisher.publish).mock.calls.filter(
      (c) => (c[2] as { type: string }).type === 'agent.decision',
    );
    expect(decisionCalls).toHaveLength(3);
    expect(decisionCalls.every((c) => (c[2] as { content: { status: string } }).content.status === 'rejected')).toBe(true);

    expect(stateManager.updateProposalStatus).toHaveBeenCalledTimes(3);
    expect(stateManager.updateProposalStatus).toHaveBeenCalledWith(TRIP_ID, 'alice', 1, 'rejected');
    expect(stateManager.updateProposalStatus).toHaveBeenCalledWith(TRIP_ID, 'bob', 1, 'rejected');
    expect(stateManager.updateProposalStatus).toHaveBeenCalledWith(TRIP_ID, 'carlos', 1, 'rejected');

    const mergeCalls = vi.mocked(eventPublisher.publish).mock.calls.filter(
      (c) => (c[2] as { type: string }).type === 'agent.merge',
    );
    expect(mergeCalls).toHaveLength(1);
    expect(stateManager.transitionStatus).toHaveBeenCalledWith(TRIP_ID, 'confirmed');
  });

  it('routing key: agent.decision, agent.merge, and workflow.* events publish under the real agent/action — not a hardcoded agent.orchestrator.propose', async () => {
    setupWithProposals(MERGED_WITH_PROPOSAL_IDS);
    driveHappyPath();

    await engine.run(TRIP_ID);

    const calls = vi.mocked(eventPublisher.publish).mock.calls;
    const decisionCall = calls.find((c) => (c[2] as { type: string }).type === 'agent.decision' && (c[2] as { agent: string }).agent === 'alice');
    expect(decisionCall).toBeDefined();
    expect(decisionCall![0]).toBe('alice');
    expect(decisionCall![1]).toBe('decision');

    const mergeCall = calls.find((c) => (c[2] as { type: string }).type === 'agent.merge');
    expect(mergeCall).toBeDefined();
    expect(mergeCall![0]).toBe('orchestrator');
    expect(mergeCall![1]).toBe('merge');

    const workflowCalls = calls.filter((c) => (c[2] as { type: string }).type?.startsWith('workflow.'));
    expect(workflowCalls.length).toBeGreaterThan(0);
    for (const wc of workflowCalls) {
      expect(wc[0]).toBe('orchestrator');
      expect(wc[1]).toBe('score');
    }
  });
});

describe('WorkflowEngine — parallel per-city merge calls (Part B)', () => {
  it('happy path: one callOrchestratorMerge call per city stay, run concurrently, combined into one itinerary sorted by day', async () => {
    setupTwoCityMocks();
    driveHappyPath();

    await engine.run(TRIP_ID);

    expect(agentCaller.callOrchestratorMerge).toHaveBeenCalledTimes(2);
    const targetCities = vi.mocked(agentCaller.callOrchestratorMerge).mock.calls.map((c) => c[6]);
    expect(targetCities).toEqual(['Madrid', 'Dublin']);

    const itinerary = mergedProposalContent()['itinerary'] as Array<Record<string, unknown>>;
    expect(itinerary.map((d) => d['day'])).toEqual([1, 2, 3, 4]);
    expect(itinerary.find((d) => d['day'] === 1)!['city']).toBe('Madrid');
    expect(itinerary.find((d) => d['day'] === 3)!['city']).toBe('Dublin');

    // satisfactionEstimates is computed deterministically in code now, not
    // read off either per-city LLM response (both fixtures carry none).
    expect(mergedProposalContent()['satisfactionEstimates']).toBeDefined();
  });

  it('happy path: streams per city — a fast city is processed/logged without waiting for a slower sibling still in flight', async () => {
    setupTwoCityMocks();
    let resolveDublin!: (v: { content: Record<string, unknown>; latencyMs: number; tokensUsed: number }) => void;
    const dublinPromise = new Promise<{ content: Record<string, unknown>; latencyMs: number; tokensUsed: number }>((resolve) => {
      resolveDublin = resolve;
    });
    vi.mocked(agentCaller.callOrchestratorMerge).mockImplementation(async (..._args) => {
      const targetCity = _args[6] as string;
      if (targetCity === 'Dublin') return dublinPromise;
      return { content: JSON.parse(JSON.stringify(MADRID_CITY_MERGED)), latencyMs: 200, tokensUsed: 200 };
    });
    driveHappyPath();

    const runPromise = engine.run(TRIP_ID);

    // Madrid resolves immediately — its per-city processing (enforcement +
    // decision publish + merge-city log) should complete while Dublin is
    // still pending, proving it isn't gated on Promise.all resolving for
    // every city.
    await vi.waitFor(() => {
      expect(
        vi.mocked(stateManager.logAgentCall).mock.calls.some(
          (c) => (c[0] as { reasoning?: string }).reasoning === 'city=Madrid',
        ),
      ).toBe(true);
    });
    expect(
      vi.mocked(stateManager.logAgentCall).mock.calls.some(
        (c) => (c[0] as { reasoning?: string }).reasoning === 'city=Dublin',
      ),
    ).toBe(false);

    resolveDublin({ content: JSON.parse(JSON.stringify(DUBLIN_CITY_MERGED)), latencyMs: 200, tokensUsed: 200 });
    await expect(runPromise).resolves.not.toThrow();

    expect(
      vi.mocked(stateManager.logAgentCall).mock.calls.some(
        (c) => (c[0] as { reasoning?: string }).reasoning === 'city=Dublin',
      ),
    ).toBe(true);
  });

  it('error: one of two per-city merge calls rejecting is isolated to that city — the other city\'s itinerary still publishes and saves', async () => {
    setupTwoCityMocks();
    vi.mocked(agentCaller.callOrchestratorMerge).mockImplementation(async (..._args) => {
      const targetCity = _args[6] as string;
      if (targetCity === 'Dublin') throw new Error('orchestrator-agent unreachable for Dublin');
      return { content: JSON.parse(JSON.stringify(MADRID_CITY_MERGED)), latencyMs: 200, tokensUsed: 200 };
    });
    driveHappyPath();

    await expect(engine.run(TRIP_ID)).resolves.not.toThrow();

    // Dublin's failure no longer aborts the whole merge stage — Madrid's
    // days still make it into the saved/published itinerary.
    const mergeCalls = vi.mocked(eventPublisher.publish).mock.calls.filter(
      (c) => (c[2] as { type: string }).type === 'agent.merge',
    );
    expect(mergeCalls).toHaveLength(1);

    const content = mergedProposalContent();
    const itinerary = content['itinerary'] as Array<Record<string, unknown>>;
    expect(itinerary.map((d) => d['day'])).toEqual([1, 2]);
    expect(itinerary.every((d) => d['city'] === 'Madrid')).toBe(true);
  });

  it('error: both per-city merge calls rejecting degrades to an empty itinerary without throwing', async () => {
    setupTwoCityMocks();
    vi.mocked(agentCaller.callOrchestratorMerge).mockRejectedValue(new Error('orchestrator-agent unreachable'));
    driveHappyPath();

    await expect(engine.run(TRIP_ID)).resolves.not.toThrow();

    const mergeCalls = vi.mocked(eventPublisher.publish).mock.calls.filter(
      (c) => (c[2] as { type: string }).type === 'agent.merge',
    );
    expect(mergeCalls).toHaveLength(1);

    const content = mergedProposalContent();
    expect(content['itinerary']).toEqual([]);
  });
});

describe('WorkflowEngine — group preferences reach the agents (pace / must-haves / avoids)', () => {
  // MOCK_TRIP has no trip-level `preferences`, so these cases exercise the
  // legacy path: the brief duplicated inside every traveller's own blob.
  function tripWithTravellers(travellers: Array<Record<string, unknown>>): typeof MOCK_TRIP {
    return { ...MOCK_TRIP, travellers } as unknown as typeof MOCK_TRIP;
  }

  function tripWithPreferences(
    preferences: Record<string, unknown>,
    travellers: Array<Record<string, unknown>> = [{ id: 't1' }],
  ): typeof MOCK_TRIP {
    return { ...MOCK_TRIP, preferences, travellers } as unknown as typeof MOCK_TRIP;
  }

  async function runThroughMerge(trip: typeof MOCK_TRIP): Promise<void> {
    setupCommonMocks(stateManager, eventPublisher);
    vi.mocked(stateManager.getTrip).mockResolvedValue(trip as never);

    vi.mocked(agentCaller.callLogisticsPlan).mockResolvedValue(ROUTE_GRAPH);
    vi.mocked(agentCaller.callFinanceEstimate).mockResolvedValue(BUDGET_PLAN);
    vi.mocked(agentCaller.callPreferenceAgentSlots).mockResolvedValue([
      { content: {}, latencyMs: 10, tokensUsed: 1 },
      { content: {}, latencyMs: 10, tokensUsed: 1 },
      { content: {}, latencyMs: 10, tokensUsed: 1 },
      { content: {}, latencyMs: 10, tokensUsed: 1 },
    ]);
    vi.mocked(agentCaller.callOrchestratorMerge).mockResolvedValue({
      content: MERGED_ITINERARY,
      latencyMs: 20,
      tokensUsed: 20,
    });

    driveStateMachine(stateMachine, [
      { nextState: 'LOGISTICS_PLANNING', action: { type: 'CALL_LOGISTICS_PLAN' } },
      { nextState: 'FINANCE_ENVELOPE_CHECK', action: { type: 'CALL_FINANCE_ESTIMATE' } },
      { nextState: 'PARALLEL_TURISTIC_PLANNING', action: { type: 'CALL_TOURIST_AGENTS' } },
      { nextState: 'MERGE_AND_SCORE', action: { type: 'CALL_ORCHESTRATOR_MERGE' } },
      { nextState: 'FINISH', action: { type: 'FINISH' } },
    ]);

    await engine.run(TRIP_ID);
  }

  it('happy path: reads the trip-level brief into every tourist slot', async () => {
    await runThroughMerge(
      tripWithPreferences({ pace: 'low', mustHaves: ['museus'], avoids: ['discotecas'] }),
    );

    const slots = vi.mocked(agentCaller.callPreferenceAgentSlots).mock.calls[0]![2];
    expect(slots).not.toHaveLength(0);
    for (const slot of slots) {
      expect(slot.pace).toBe('low');
      expect(slot.mustHaves).toEqual(['museus']);
      expect(slot.avoids).toEqual(['discotecas']);
    }
  });

  it('happy path: forwards the trip-level brief to the merge call', async () => {
    await runThroughMerge(tripWithPreferences({ pace: 'high', mustHaves: ['praias'], avoids: [] }));

    const preferences = vi.mocked(agentCaller.callOrchestratorMerge).mock.calls[0]![7];
    expect(preferences).toEqual({ pace: 'high', mustHaves: ['praias'], avoids: [] });
  });

  it('the trip-level brief wins over stale per-traveller copies', async () => {
    await runThroughMerge(
      tripWithPreferences({ pace: 'low', mustHaves: ['museus'], avoids: ['discotecas'] }, [
        { id: 't1', preferences: { pace: 'high', mustHaves: ['bares'], avoids: ['museus'] } },
      ]),
    );

    const slots = vi.mocked(agentCaller.callPreferenceAgentSlots).mock.calls[0]![2];
    expect(slots[0]!.pace).toBe('low');
    expect(slots[0]!.mustHaves).toEqual(['museus']);
    expect(slots[0]!.avoids).toEqual(['discotecas']);
  });

  it('maps a trip-level dealBreakers key onto avoids', async () => {
    await runThroughMerge(tripWithPreferences({ dealBreakers: ['casinos'] }));

    const slots = vi.mocked(agentCaller.callPreferenceAgentSlots).mock.calls[0]![2];
    expect(slots[0]!.avoids).toEqual(['casinos']);
  });

  it('error: an empty trip-level blob falls back to the travellers (legacy trip)', async () => {
    await runThroughMerge(
      tripWithPreferences({}, [{ id: 't1', preferences: { pace: 'high', mustHaves: ['bares'] } }]),
    );

    const slots = vi.mocked(agentCaller.callPreferenceAgentSlots).mock.calls[0]![2];
    expect(slots[0]!.pace).toBe('high');
    expect(slots[0]!.mustHaves).toEqual(['bares']);
  });

  it('legacy: reads pace/mustHaves/avoids from the travellers into every tourist slot', async () => {
    await runThroughMerge(
      tripWithTravellers([
        { id: 't1', preferences: { pace: 'low', mustHaves: ['museus'], avoids: ['discotecas'] } },
        { id: 't2', preferences: { pace: 'low', mustHaves: ['praias'], avoids: [] } },
      ]),
    );

    const slots = vi.mocked(agentCaller.callPreferenceAgentSlots).mock.calls[0]![2];
    expect(slots).not.toHaveLength(0);
    for (const slot of slots) {
      expect(slot.pace).toBe('low');
      expect(slot.mustHaves).toEqual(['museus', 'praias']);
      expect(slot.avoids).toEqual(['discotecas']);
    }
  });

  it('happy path: forwards the same preferences to the merge call as a structured argument', async () => {
    await runThroughMerge(
      tripWithTravellers([
        { id: 't1', preferences: { pace: 'high', mustHaves: ['museus'], avoids: ['casinos'] } },
      ]),
    );

    const preferences = vi.mocked(agentCaller.callOrchestratorMerge).mock.calls[0]![7];
    expect(preferences).toEqual({ pace: 'high', mustHaves: ['museus'], avoids: ['casinos'] });
  });

  it('maps the legacy dealBreakers key onto avoids for trips created before the rename', async () => {
    await runThroughMerge(
      tripWithTravellers([{ id: 't1', preferences: { pace: 'medium', dealBreakers: ['discotecas'] } }]),
    );

    const slots = vi.mocked(agentCaller.callPreferenceAgentSlots).mock.calls[0]![2];
    expect(slots[0]!.avoids).toEqual(['discotecas']);
  });

  it('error: a trip whose travellers have no preferences falls back to defaults instead of throwing', async () => {
    await runThroughMerge(tripWithTravellers([{ id: 't1' }]));

    const slots = vi.mocked(agentCaller.callPreferenceAgentSlots).mock.calls[0]![2];
    expect(slots[0]!.pace).toBe('medium');
    expect(slots[0]!.mustHaves).toEqual([]);
    expect(slots[0]!.avoids).toEqual([]);
  });

  it('error: a trip with no travellers at all still runs with default preferences', async () => {
    await runThroughMerge(tripWithTravellers([]));

    expect(agentCaller.callPreferenceAgentSlots).toHaveBeenCalledOnce();
    const slots = vi.mocked(agentCaller.callPreferenceAgentSlots).mock.calls[0]![2];
    expect(slots[0]!.pace).toBe('medium');
  });
});

describe('WorkflowEngine — activity category backfill and validator hand-off', () => {
  const SLOT_PROPOSALS = {
    slotProposals: [
      {
        id: 'p1',
        city: 'Barcelona',
        date: '2026-08-10',
        slot: 'morning',
        activity: 'Museu Picasso',
        estimatedCostPerPerson: 12,
        category: 'museum',
      },
      {
        id: 'p2',
        city: 'Barcelona',
        date: '2026-08-11',
        slot: 'afternoon',
        activity: 'Barceloneta',
        estimatedCostPerPerson: 0,
        // No category on the source proposal.
      },
    ],
  };

  const MERGED_WITH_IDS = {
    itinerary: [
      {
        day: 1,
        city: 'Barcelona',
        activities: [
          { activity: 'Museu Picasso', venue: 'Museu Picasso', proposalIds: ['p1'] },
          { activity: 'Barceloneta', venue: 'Praia', proposalIds: ['p2'] },
          { activity: 'Unknown source', venue: 'Somewhere', proposalIds: ['p-missing'] },
          { activity: 'No link at all', venue: 'Elsewhere' },
          { activity: 'Already categorised', venue: 'Bar', proposalIds: ['p1'], category: 'nightlife' },
        ],
      },
    ],
    accommodation: [],
    _financeApproved: true,
    _budgetFeasible: true,
  };

  async function runWithSlotProposals(trip: typeof MOCK_TRIP = MOCK_TRIP): Promise<void> {
    setupCommonMocks(stateManager, eventPublisher);
    vi.mocked(stateManager.getTrip).mockResolvedValue(trip as never);
    vi.mocked(agentCaller.callLogisticsPlan).mockResolvedValue(ROUTE_GRAPH);
    vi.mocked(agentCaller.callFinanceEstimate).mockResolvedValue(BUDGET_PLAN);
    vi.mocked(agentCaller.callPreferenceAgentSlots).mockResolvedValue([
      { content: SLOT_PROPOSALS, latencyMs: 10, tokensUsed: 1 },
      { content: {}, latencyMs: 10, tokensUsed: 1 },
      { content: {}, latencyMs: 10, tokensUsed: 1 },
      { content: {}, latencyMs: 10, tokensUsed: 1 },
    ]);
    vi.mocked(agentCaller.callOrchestratorMerge).mockResolvedValue({
      content: MERGED_WITH_IDS,
      latencyMs: 20,
      tokensUsed: 20,
    });
    vi.mocked(agentCaller.callFinanceAgent).mockResolvedValue({
      content: { verdict: { approved: true, budgetFeasible: true, issues: [] } },
      latencyMs: 10,
      tokensUsed: 10,
    });
    vi.mocked(agentCaller.callValidatorAgent).mockResolvedValue({
      content: { scoring: { overallScore: 80 } },
      latencyMs: 10,
      tokensUsed: 10,
    });
    driveHappyPath();

    await engine.run(TRIP_ID);
  }

  function mergedActivities(): Array<Record<string, unknown>> {
    const itinerary = mergedProposalContent()['itinerary'] as Array<Record<string, unknown>>;
    return itinerary.flatMap((d) => (d['activities'] as Array<Record<string, unknown>>) ?? []);
  }

  it('happy path: stamps the source slot proposal category onto the merged activity', async () => {
    await runWithSlotProposals();

    const museum = mergedActivities().find((a) => a['activity'] === 'Museu Picasso');
    expect(museum!['category']).toBe('museum');
  });

  it('leaves an activity whose source proposal has no category untouched', async () => {
    await runWithSlotProposals();

    const beach = mergedActivities().find((a) => a['activity'] === 'Barceloneta');
    expect(beach!['category']).toBeUndefined();
  });

  it('error: an unknown or absent proposalId does not crash the merge', async () => {
    await runWithSlotProposals();

    const activities = mergedActivities();
    expect(activities.find((a) => a['activity'] === 'Unknown source')!['category']).toBeUndefined();
    expect(activities.find((a) => a['activity'] === 'No link at all')!['category']).toBeUndefined();
  });

  it('never overwrites a category the merge already produced', async () => {
    await runWithSlotProposals();

    const already = mergedActivities().find((a) => a['activity'] === 'Already categorised');
    expect(already!['category']).toBe('nightlife');
  });

  it('happy path: forwards the trip-level must-haves and avoids to the validator', async () => {
    await runWithSlotProposals({
      ...MOCK_TRIP,
      preferences: { pace: 'low', mustHaves: ['museus'], avoids: ['discotecas'] },
    } as unknown as typeof MOCK_TRIP);

    expect(agentCaller.callValidatorAgent).toHaveBeenCalledWith(
      TRIP_ID,
      2,
      expect.any(Object),
      { mustHaves: ['museus'], avoids: ['discotecas'] },
    );
  });

  it('error: a validator failure still finalises the run instead of throwing', async () => {
    setupCommonMocks(stateManager, eventPublisher);
    vi.mocked(stateManager.getTrip).mockResolvedValue(MOCK_TRIP as never);
    vi.mocked(agentCaller.callLogisticsPlan).mockResolvedValue(ROUTE_GRAPH);
    vi.mocked(agentCaller.callFinanceEstimate).mockResolvedValue(BUDGET_PLAN);
    vi.mocked(agentCaller.callPreferenceAgentSlots).mockResolvedValue([
      { content: SLOT_PROPOSALS, latencyMs: 10, tokensUsed: 1 },
    ]);
    vi.mocked(agentCaller.callOrchestratorMerge).mockResolvedValue({
      content: MERGED_WITH_IDS,
      latencyMs: 20,
      tokensUsed: 20,
    });
    vi.mocked(agentCaller.callFinanceAgent).mockResolvedValue({
      content: { verdict: { approved: true, budgetFeasible: true, issues: [] } },
      latencyMs: 10,
      tokensUsed: 10,
    });
    vi.mocked(agentCaller.callValidatorAgent).mockRejectedValue(new Error('validator down'));
    driveHappyPath();

    await expect(engine.run(TRIP_ID)).resolves.toBeUndefined();
  });
});

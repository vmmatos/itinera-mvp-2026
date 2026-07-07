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

const TWO_CITY_MERGED = {
  accommodation: [],
  itinerary: [
    { day: 1, city: 'Madrid', country: 'Spain', activities: [{ time: 'morning', activity: 'Prado Museum' }] },
    { day: 2, city: 'Madrid', country: 'Spain', activities: [] },
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
  _financeApproved: true,
  _budgetFeasible: true,
};

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
  vi.mocked(agentCaller.callOrchestratorMerge).mockResolvedValue({
    content: JSON.parse(JSON.stringify(TWO_CITY_MERGED)) as Record<string, unknown>,
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

  const LATE_DEP_MERGED = {
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
      { day: 4, city: 'Dublin', country: 'Ireland', activities: [
        { time: 'morning', activity: 'Check in and rest' },
      ] },
    ],
    _financeApproved: true,
    _budgetFeasible: true,
  };

  it('labels the travel day with the ORIGIN city, keeps its daytime activities, strips the evening slip, stamps transport there', async () => {
    setupTwoCityMocks();
    vi.mocked(agentCaller.callLogisticsPlan).mockResolvedValue(lateDepartureRouteGraph());
    vi.mocked(agentCaller.callOrchestratorMerge).mockResolvedValue({
      content: JSON.parse(JSON.stringify(LATE_DEP_MERGED)) as Record<string, unknown>,
      latencyMs: 200,
      tokensUsed: 200,
    });
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

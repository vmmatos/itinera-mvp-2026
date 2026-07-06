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
import type { RouteGraph } from '@itinera/shared';
import {
  TRIP_ID, MOCK_TRIP, BUDGET_PLAN_FEASIBLE,
  TOURIST_SLOT_RESULTS, FINANCE_APPROVED_RESULT, VALIDATION_PASS_RESULT,
} from './helpers/workflow-fixtures';

// ── Scenario 017: car preference on a long leg → organic hybrid decision ─────
//
// Mértola → Barcelona (~990 km). The user prefers car, but the pure drive is
// 11h — beyond the 8h leg time limit. The logistics weighted scorer ranks the
// hybrid "drive to Lisboa + fly" first (partial car alignment). The REAL
// TransportPriorityEngine must: find no viable pure-car offer (over time
// limit), downgrade with an explicit reason, and the WorkflowEngine must
// surface that reason in the injected transport warnings so the user sees why
// their preference wasn't honoured — alongside priced alternatives.

const CAR_PREFERRED_TRIP = {
  ...MOCK_TRIP,
  name: 'Alentejo to Catalunya',
  destinations: [
    { country: 'Portugal', city: 'Mértola', nights: 2 },
    { country: 'Spain', city: 'Barcelona', nights: 3 },
  ],
  transportPreference: 'car',
  dateInput: { mode: 'fixed', startDate: '2026-09-10', endDate: '2026-09-15' },
};

const HYBRID_ROUTE: RouteGraph = {
  orderedLegs: [
    {
      from: 'Mértola',
      to: 'Barcelona',
      departureDate: '2026-09-12',
      // Winner by weighted score: car to Lisboa + flight (partial car alignment).
      bestOption: {
        mode: 'flight',
        durationMinutes: 250,
        priceEur: 116,
        departureTime: '11:30',
        warnings: ['car preference overridden — car takes ~11h here vs ~4h for this option'],
        segments: [
          { from: 'Mértola', to: 'Lisboa', mode: 'car', durationMinutes: 130, priceEur: 26 },
          { from: 'Lisboa', to: 'Barcelona', mode: 'flight', durationMinutes: 120, priceEur: 90 },
        ],
        displaySummary: 'Car + Flight — 4h10m total, ~€116/person',
      },
      alternatives: [
        // Pure drive: over the 480-min leg time limit → not a viable car offer.
        { mode: 'car', durationMinutes: 660, priceEur: 218, warnings: ['Long drive (~11h) — consider flying.'] },
        { mode: 'flight', durationMinutes: 300, priceEur: 95, warnings: [], segments: [
          { from: 'Mértola', to: 'Faro', mode: 'bus', durationMinutes: 90, priceEur: 9 },
          { from: 'Faro', to: 'Barcelona', mode: 'flight', durationMinutes: 210, priceEur: 86 },
        ] },
      ],
      totalCostEurPerPerson: 116,
    },
  ],
  cityStays: [
    {
      city: 'Mértola', country: 'Portugal', arrivalDate: '2026-09-10', departureDate: '2026-09-12',
      nights: 2, timeWindows: [], sleepPoint: 'Centro histórico', budgetPerPersonPerNight: 60,
    },
    {
      city: 'Barcelona', country: 'Spain', arrivalDate: '2026-09-12', departureDate: '2026-09-15',
      nights: 3, timeWindows: [], sleepPoint: 'Eixample', budgetPerPersonPerNight: 95,
    },
  ],
  totalTransportCostEurPerPerson: 116,
  totalDurationDays: 5,
};

const MERGED_CONTENT = {
  accommodation: [],
  itinerary: [
    { day: 1, city: 'Mértola', country: 'Portugal', activities: [] },
    { day: 2, city: 'Mértola', country: 'Portugal', activities: [] },
    { day: 3, city: 'Barcelona', country: 'Spain', activities: [
      { time: 'morning', activity: 'Drive to Lisboa and fly to Barcelona' },
    ] },
    { day: 4, city: 'Barcelona', country: 'Spain', activities: [] },
    { day: 5, city: 'Barcelona', country: 'Spain', activities: [] },
  ],
  satisfactionEstimates: { alice: 0.8, bob: 0.8, carlos: 0.8, diana: 0.8 },
};

describe('Scenario 017 — WorkflowEngine v2: car preference resolves to hybrid car+flight with reason', () => {
  let stateManager: StateManager;
  let agentCaller: AgentCaller;
  let engine: WorkflowEngine;
  let savedContexts: Array<Record<string, unknown>>;

  beforeEach(() => {
    vi.clearAllMocks();
    savedContexts = [];
    stateManager = new StateManager();
    agentCaller = new AgentCaller();
    engine = new WorkflowEngine(new WorkflowStateMachine(), stateManager, agentCaller, new EventPublisher());

    vi.mocked(stateManager.getTrip).mockResolvedValue(CAR_PREFERRED_TRIP as never);
    vi.mocked(stateManager.saveWorkflowContext).mockImplementation(async (_, ctx) => {
      savedContexts.push(ctx as unknown as Record<string, unknown>);
    });
    vi.mocked(agentCaller.callLogisticsPlan).mockResolvedValue(JSON.parse(JSON.stringify(HYBRID_ROUTE)) as RouteGraph);
    vi.mocked(agentCaller.callFinanceEstimate).mockResolvedValue(BUDGET_PLAN_FEASIBLE);
    vi.mocked(agentCaller.callPreferenceAgentSlots).mockResolvedValue(TOURIST_SLOT_RESULTS);
    vi.mocked(agentCaller.callOrchestratorMerge).mockResolvedValue({
      content: JSON.parse(JSON.stringify(MERGED_CONTENT)) as Record<string, unknown>,
      latencyMs: 350,
      tokensUsed: 800,
    });
    vi.mocked(agentCaller.callFinanceAgent).mockResolvedValue(FINANCE_APPROVED_RESULT);
    vi.mocked(agentCaller.callValidatorAgent).mockResolvedValue(VALIDATION_PASS_RESULT);
  });

  function mergedProposal(): Record<string, unknown> {
    const call = vi.mocked(stateManager.saveProposal).mock.calls.find(
      (c) => (c[0] as { agent: string }).agent === 'orchestrator',
    );
    expect(call).toBeDefined();
    return (call![0] as { content: Record<string, unknown> }).content;
  }

  it('completes to confirmed — a downgrade is not an error', async () => {
    await engine.run(TRIP_ID);
    expect(stateManager.transitionStatus).toHaveBeenCalledWith(TRIP_ID, 'confirmed');
  });

  it('real TransportPriorityEngine downgrades: pure car exceeds the leg time limit', async () => {
    await engine.run(TRIP_ID);
    const ctx = savedContexts.find((c) => c['transportPriority'] !== undefined) as {
      transportPriority?: { wasPreferenceHonored: boolean; selectedMode: string; downgradeReason?: string };
      transportPriorities?: unknown[];
    } | undefined;
    expect(ctx).toBeDefined();
    expect(ctx!.transportPriority!.wasPreferenceHonored).toBe(false);
    expect(ctx!.transportPriority!.selectedMode).toBe('flight');
    expect(ctx!.transportPriority!.downgradeReason).toMatch(/time limit/i);
    expect(ctx!.transportPriorities).toHaveLength(1);
  });

  it('travel day carries the hybrid leg: car segment + flight segment, downgrade reason and alternatives visible', async () => {
    await engine.run(TRIP_ID);
    const itinerary = mergedProposal()['itinerary'] as Array<Record<string, unknown>>;
    const day3 = itinerary.find((d) => d['day'] === 3)!;
    const transport = (day3['transport'] as Array<Record<string, unknown>>)[0];

    const segments = transport['segments'] as Array<Record<string, unknown>>;
    expect(segments.map((s) => s['mode'])).toEqual(['car', 'flight']);

    const warnings = transport['warnings'] as string[];
    expect(warnings.some((w) => w.includes('car preference not used') && /time limit/i.test(w))).toBe(true);
    expect(warnings.some((w) => w.includes('car preference overridden'))).toBe(true);

    const alternatives = transport['alternatives'] as Array<Record<string, unknown>>;
    expect(alternatives.length).toBeGreaterThanOrEqual(2);
    expect(alternatives.every((a) => typeof a['priceEur'] === 'number')).toBe(true);
  });
});

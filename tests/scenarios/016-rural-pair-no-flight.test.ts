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
import type { RouteGraph } from '@itinera/shared';
import {
  TRIP_ID, MOCK_TRIP, BUDGET_PLAN_FEASIBLE,
  TOURIST_SLOT_RESULTS, FINANCE_APPROVED_RESULT, VALIDATION_PASS_RESULT,
} from './helpers/workflow-fixtures';

// ── Scenario 016: rural pair — no hallucinated flight, transit slots clean ────
//
// Mértola → Comporta (~150 km): the logistics agent resolves a real 2.5h drive
// (the TransportService distance guard prevents any flight from ever being
// searched or synthesised for such a leg). The routeGraph marks Comporta's
// arrival morning as inbound-transit. Even if the merge LLM slips a tourist
// activity into that blocked slot, the WorkflowEngine's deterministic guard
// must strip it, and the final proposal must contain a car leg — never a flight.

const RURAL_TRIP = {
  ...MOCK_TRIP,
  name: 'Alentejo escape',
  destinations: [
    { country: 'Portugal', city: 'Mértola', nights: 2 },
    { country: 'Portugal', city: 'Comporta', nights: 2 },
  ],
  transportPreference: 'car',
  dateInput: { mode: 'fixed', startDate: '2026-09-10', endDate: '2026-09-14' },
};

const CAR_LEG_ROUTE: RouteGraph = {
  orderedLegs: [
    {
      from: 'Mértola',
      to: 'Comporta',
      departureDate: '2026-09-12',
      // Real drive resolved via Google Distance Matrix + fuel/tolls heuristic.
      bestOption: { mode: 'car', durationMinutes: 150, priceEur: 33, warnings: [] },
      alternatives: [
        { mode: 'car', durationMinutes: 240, priceEur: 20, warnings: [], segments: [
          { from: 'Mértola', to: 'Beja', mode: 'bus', durationMinutes: 55, priceEur: 5 },
          { from: 'Beja', to: 'Comporta', mode: 'car', durationMinutes: 185, priceEur: 15 },
        ] },
      ],
      totalCostEurPerPerson: 33,
    },
  ],
  cityStays: [
    {
      city: 'Mértola', country: 'Portugal', arrivalDate: '2026-09-10', departureDate: '2026-09-12',
      nights: 2, timeWindows: [], sleepPoint: 'Centro histórico', budgetPerPersonPerNight: 60,
    },
    {
      city: 'Comporta', country: 'Portugal', arrivalDate: '2026-09-12', departureDate: '2026-09-14',
      nights: 2,
      timeWindows: [
        // Arrival day: morning consumed by the drive — blocked.
        { date: '2026-09-12', slot: 'morning', durationMinutes: 120, isTransitDay: true, blockedReason: 'inbound-transit' },
        { date: '2026-09-12', slot: 'afternoon', durationMinutes: 120, isTransitDay: false },
        { date: '2026-09-12', slot: 'evening', durationMinutes: 120, isTransitDay: false },
        { date: '2026-09-13', slot: 'morning', durationMinutes: 120, isTransitDay: false },
        { date: '2026-09-13', slot: 'afternoon', durationMinutes: 120, isTransitDay: false },
        { date: '2026-09-13', slot: 'evening', durationMinutes: 120, isTransitDay: false },
      ],
      sleepPoint: 'Comporta village', budgetPerPersonPerNight: 110,
    },
  ],
  totalTransportCostEurPerPerson: 33,
  totalDurationDays: 4,
};

// Merge output where the LLM slipped a beach activity into the blocked morning.
const MERGED_WITH_SLIP = {
  accommodation: [],
  itinerary: [
    { day: 1, city: 'Mértola', country: 'Portugal', activities: [
      { time: 'morning', activity: 'Old town and castle walk' },
    ] },
    { day: 2, city: 'Mértola', country: 'Portugal', activities: [] },
    { day: 3, city: 'Comporta', country: 'Portugal', activities: [
      { time: 'morning', activity: 'In transit from Mértola' },
      { time: 'morning', activity: 'Beach yoga session' }, // LLM slip — blocked slot
      { time: 'afternoon', activity: 'Comporta beach afternoon' },
    ] },
    { day: 4, city: 'Comporta', country: 'Portugal', activities: [] },
  ],
  satisfactionEstimates: { alice: 0.8, bob: 0.8, carlos: 0.8, diana: 0.8 },
};

describe('Scenario 016 — WorkflowEngine v2: rural pair keeps ground transport + clean transit slots', () => {
  let stateManager: StateManager;
  let agentCaller: AgentCaller;
  let engine: WorkflowEngine;

  beforeEach(() => {
    vi.clearAllMocks();
    stateManager = new StateManager();
    agentCaller = new AgentCaller();
    engine = new WorkflowEngine(new WorkflowStateMachine(), stateManager, agentCaller, new EventPublisher());

    vi.mocked(stateManager.getTrip).mockResolvedValue(RURAL_TRIP as never);
    vi.mocked(agentCaller.callLogisticsPlan).mockResolvedValue(CAR_LEG_ROUTE);
    vi.mocked(agentCaller.callFinanceEstimate).mockResolvedValue(BUDGET_PLAN_FEASIBLE);
    vi.mocked(agentCaller.callPreferenceAgentSlots).mockResolvedValue(TOURIST_SLOT_RESULTS);
    vi.mocked(agentCaller.callOrchestratorMerge).mockResolvedValue({
      content: JSON.parse(JSON.stringify(MERGED_WITH_SLIP)) as Record<string, unknown>,
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

  it('completes to confirmed', async () => {
    await engine.run(TRIP_ID);
    expect(stateManager.transitionStatus).toHaveBeenCalledWith(TRIP_ID, 'confirmed');
  });

  it('final proposal transports are ground-only — no flight anywhere', async () => {
    await engine.run(TRIP_ID);
    const itinerary = mergedProposal()['itinerary'] as Array<Record<string, unknown>>;
    for (const day of itinerary) {
      const transport = Array.isArray(day['transport']) ? (day['transport'] as Array<Record<string, unknown>>) : [];
      for (const t of transport) {
        expect(t['mode']).not.toBe('flight');
        const segments = Array.isArray(t['segments']) ? (t['segments'] as Array<Record<string, unknown>>) : [];
        expect(segments.every((s) => s['mode'] !== 'flight')).toBe(true);
      }
    }
  });

  it('travel day carries the real car leg with duration and price', async () => {
    await engine.run(TRIP_ID);
    const itinerary = mergedProposal()['itinerary'] as Array<Record<string, unknown>>;
    const day3 = itinerary.find((d) => d['day'] === 3)!;
    const transport = (day3['transport'] as Array<Record<string, unknown>>)[0];
    expect(transport).toMatchObject({ mode: 'car', durationMinutes: 150, priceEur: 33 });
  });

  it('blocked transit slot holds no tourist activities — only the transit placeholder', async () => {
    await engine.run(TRIP_ID);
    const itinerary = mergedProposal()['itinerary'] as Array<Record<string, unknown>>;
    const day3 = itinerary.find((d) => d['day'] === 3)!;
    const acts = (day3['activities'] as Array<Record<string, unknown>>);
    const morning = acts.filter((a) => a['time'] === 'morning').map((a) => a['activity']);
    expect(morning).toContain('In transit from Mértola');
    expect(morning).not.toContain('Beach yoga session');
    // Free slots untouched.
    expect(acts.some((a) => a['activity'] === 'Comporta beach afternoon')).toBe(true);
  });
});

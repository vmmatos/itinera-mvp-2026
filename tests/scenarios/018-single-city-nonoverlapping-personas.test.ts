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
import type { RouteGraph, BudgetPlan } from '@itinera/shared';
import { TRIP_ID, MOCK_TRIP, TOURIST_SLOT_RESULTS, FINANCE_APPROVED_RESULT } from './helpers/workflow-fixtures';

// ── Scenario 018: single city, group has no culture/gastronomy traveller ─────
//
// Reproduces the real-world failure on trip 4866de5c-07e3-4063-8d55-c65226be05eb
// (Lucerne, 1 city, 2 travellers): a group of 2 real travellers — one `action`,
// one `relaxation` — with NO `culture` or `gastronomy` traveller in the group at
// all. Before this fix, the merge prompt only guaranteed "each of the 4 tourist
// agents gets at least one activity" (agent-count fairness, not real-traveller
// fairness), so a merge could — and on the real trip, did — hand every single
// slot to alice (culture) and diana (gastronomy) while bob (relaxation) and
// carlos (action) got zero. The validator then scored both real travellers low
// against their own persona's categories, and FINAL_VALIDATION had no retry
// path for a low score (unlike FINANCE_VALIDATE, which retries via a re-merge
// since M106) — so the trip cancelled immediately with no diagnosis.
//
// This scenario asserts the two-part fix: (1) `personaWeights` — the count of
// real travellers per persona — reaches the merge call, so the LLM knows there
// is no real culture/gastronomy traveller in this group; and (2) a low score no
// longer cancels outright — FINAL_VALIDATION routes back through a real
// re-merge (MERGE_AND_SCORE + context.scoreFeedback naming the underserved
// travellers/categories), and the trip only cancels if that retry is also
// exhausted. Uses the REAL WorkflowStateMachine (not mocked) so the retry
// wiring itself is under test, not just WorkflowEngine's own bookkeeping.

const SINGLE_CITY_TRIP = {
  ...MOCK_TRIP,
  name: 'Lucerne long weekend',
  destinations: [{ country: 'Switzerland', city: 'Lucerne', nights: 3 }],
  travellers: [
    { id: 't1', preferences: { persona: 'action', flexibility: 'high', pace: 'high' } },
    { id: 't2', preferences: { persona: 'relaxation', flexibility: 'high', pace: 'low' } },
  ],
  budgetTotal: 3000,
  budgetCurrency: 'EUR',
  transportPreference: 'best',
  dateInput: { mode: 'fixed', startDate: '2026-08-28', endDate: '2026-08-31' },
};

const SINGLE_CITY_ROUTE: RouteGraph = {
  orderedLegs: [],
  cityStays: [
    {
      city: 'Lucerne',
      country: 'Switzerland',
      arrivalDate: '2026-08-28',
      departureDate: '2026-08-31',
      nights: 3,
      timeWindows: [
        { date: '2026-08-28', slot: 'morning', durationMinutes: 120, isTransitDay: false },
        { date: '2026-08-28', slot: 'afternoon', durationMinutes: 120, isTransitDay: false },
        { date: '2026-08-28', slot: 'evening', durationMinutes: 120, isTransitDay: false },
      ],
      sleepPoint: 'Lucerne city centre',
      budgetPerPersonPerNight: 175,
    },
  ],
  totalTransportCostEurPerPerson: 0,
  totalDurationDays: 3,
};

const SINGLE_CITY_BUDGET: BudgetPlan = {
  perBlock: [
    { city: 'Lucerne', transportCostEurPerPerson: 0, accommodationBudgetEurPerPerson: 525, experiencesBudgetEurPerPerson: 975, totalEurPerPerson: 1500 },
  ],
  totalEurPerPerson: 1500,
  grandTotal: 3000,
  feasible: true,
  bufferPct: 65,
  currency: 'EUR',
};

// First merge attempt — reproduces the real failure: every activity is
// culture/gastronomy content, nothing for the action/relaxation travellers.
const CULTURE_ONLY_MERGED = {
  accommodation: [],
  itinerary: [
    { day: 1, city: 'Lucerne', country: 'Switzerland', activities: [
      { time: 'morning', activity: 'Chapel Bridge walk', venue: 'Kapellbrücke', category: 'history', ownerAgent: 'alice', estimatedCostPerPerson: 0 },
      { time: 'afternoon', activity: 'Wine and cheese pairing', venue: 'Weinstube Rebstock', category: 'gastronomy', ownerAgent: 'diana', estimatedCostPerPerson: 55 },
      { time: 'evening', activity: 'Fine dining', venue: 'Restaurant Jasper', category: 'fine-dining', ownerAgent: 'diana', estimatedCostPerPerson: 130 },
    ] },
    { day: 2, city: 'Lucerne', country: 'Switzerland', activities: [] },
    { day: 3, city: 'Lucerne', country: 'Switzerland', activities: [] },
  ],
  satisfactionEstimates: { alice: 0.85, bob: 0.1, carlos: 0.1, diana: 0.88 },
};

// Second merge attempt — after the persona-rebalance retry, bob/carlos
// actually get slots that match the real travellers' personas.
const REBALANCED_MERGED = {
  accommodation: [],
  itinerary: [
    { day: 1, city: 'Lucerne', country: 'Switzerland', activities: [
      { time: 'morning', activity: 'Mount Pilatus hike', venue: 'Pilatus', category: 'hiking', ownerAgent: 'carlos', estimatedCostPerPerson: 45 },
      { time: 'afternoon', activity: 'Lake Lucerne beach relaxation', venue: 'Lido Luzern', category: 'beach', ownerAgent: 'bob', estimatedCostPerPerson: 10 },
      { time: 'evening', activity: 'Fine dining', venue: 'Restaurant Jasper', category: 'fine-dining', ownerAgent: 'diana', estimatedCostPerPerson: 130 },
    ] },
    { day: 2, city: 'Lucerne', country: 'Switzerland', activities: [] },
    { day: 3, city: 'Lucerne', country: 'Switzerland', activities: [] },
  ],
  satisfactionEstimates: { alice: 0.7, bob: 0.8, carlos: 0.82, diana: 0.75 },
};

describe('Scenario 018 — WorkflowEngine v2: single city, no culture/gastronomy traveller, low score retries instead of cancelling', () => {
  let stateManager: StateManager;
  let agentCaller: AgentCaller;
  let engine: WorkflowEngine;
  let savedContexts: Array<Record<string, unknown>>;

  beforeEach(() => {
    vi.clearAllMocks();
    savedContexts = [];
    stateManager = new StateManager();
    agentCaller = new AgentCaller();
    // Uses the REAL WorkflowStateMachine — this scenario is specifically
    // guarding the FINAL_VALIDATION retry wiring, not just WorkflowEngine.
    engine = new WorkflowEngine(new WorkflowStateMachine(), stateManager, agentCaller, new EventPublisher());

    vi.mocked(stateManager.getTrip).mockResolvedValue(SINGLE_CITY_TRIP as never);
    vi.mocked(stateManager.saveWorkflowContext).mockImplementation(async (_, ctx) => {
      savedContexts.push(ctx as unknown as Record<string, unknown>);
    });
    vi.mocked(agentCaller.callLogisticsPlan).mockResolvedValue(JSON.parse(JSON.stringify(SINGLE_CITY_ROUTE)) as RouteGraph);
    vi.mocked(agentCaller.callFinanceEstimate).mockResolvedValue(SINGLE_CITY_BUDGET);
    vi.mocked(agentCaller.callPreferenceAgentSlots).mockResolvedValue(TOURIST_SLOT_RESULTS);
    vi.mocked(agentCaller.callOrchestratorMerge)
      .mockResolvedValueOnce({
        content: JSON.parse(JSON.stringify(CULTURE_ONLY_MERGED)) as Record<string, unknown>,
        latencyMs: 350,
        tokensUsed: 800,
      })
      .mockResolvedValueOnce({
        content: JSON.parse(JSON.stringify(REBALANCED_MERGED)) as Record<string, unknown>,
        latencyMs: 350,
        tokensUsed: 800,
      });
    vi.mocked(agentCaller.callFinanceAgent).mockResolvedValue(FINANCE_APPROVED_RESULT);
    vi.mocked(agentCaller.callValidatorAgent)
      .mockResolvedValueOnce({
        content: {
          scoring: {
            overallScore: 25,
            scores: [
              { travellerId: 't1', label: 'Vitor', score: 20 },
              { travellerId: 't2', label: 'Joana', score: 30 },
            ],
          },
        },
        latencyMs: 180,
        tokensUsed: 200,
      })
      .mockResolvedValueOnce({
        content: { scoring: { overallScore: 72, scores: [
          { travellerId: 't1', label: 'Vitor', score: 70 },
          { travellerId: 't2', label: 'Joana', score: 74 },
        ] } },
        latencyMs: 180,
        tokensUsed: 200,
      });
  });

  it('completes to confirmed — a low first score is not an immediate cancel', async () => {
    await engine.run(TRIP_ID);
    expect(stateManager.transitionStatus).toHaveBeenCalledWith(TRIP_ID, 'confirmed');
    expect(stateManager.transitionStatus).not.toHaveBeenCalledWith(TRIP_ID, 'cancelled');
  });

  it('personaWeights reaching the merge reflect only the real travellers — no culture or gastronomy weight at all', async () => {
    await engine.run(TRIP_ID);
    const firstMergeArgs = vi.mocked(agentCaller.callOrchestratorMerge).mock.calls[0]!;
    const preferences = firstMergeArgs[7] as { personaWeights?: Record<string, number> };
    expect(preferences.personaWeights).toEqual({ action: 1, relaxation: 1 });
    expect(preferences.personaWeights).not.toHaveProperty('culture');
    expect(preferences.personaWeights).not.toHaveProperty('gastronomy');
  });

  it('the low-scoring first attempt triggers a real re-merge — round bumps and a persona-rebalance instruction names the underserved travellers', async () => {
    await engine.run(TRIP_ID);

    expect(agentCaller.callOrchestratorMerge).toHaveBeenCalledTimes(2);
    const firstMergeArgs = vi.mocked(agentCaller.callOrchestratorMerge).mock.calls[0]!;
    const secondMergeArgs = vi.mocked(agentCaller.callOrchestratorMerge).mock.calls[1]!;

    expect(firstMergeArgs[1]).toBe(1);
    expect(secondMergeArgs[1]).toBe(2);

    expect(firstMergeArgs[5]).not.toContain('PERSONA REBALANCE RETRY');
    const secondTripContext = secondMergeArgs[5] as string;
    expect(secondTripContext).toContain('PERSONA REBALANCE RETRY');
    expect(secondTripContext).toContain('Vitor (action) scored 20/100');
    expect(secondTripContext).toContain('Joana (relaxation) scored 30/100');
  });

  it('scoreFeedback is populated in the saved context right after the low score and cleared once the retry passes', async () => {
    await engine.run(TRIP_ID);

    const afterLowScore = savedContexts.find((c) => c['scoreFeedback'] !== undefined) as
      { scoreFeedback?: { overallScore: number; lowScoringTravellers: unknown[] } } | undefined;
    expect(afterLowScore).toBeDefined();
    expect(afterLowScore!.scoreFeedback!.overallScore).toBe(25);
    expect(afterLowScore!.scoreFeedback!.lowScoringTravellers).toHaveLength(2);

    const last = savedContexts[savedContexts.length - 1] as { scoreFeedback?: unknown };
    expect(last.scoreFeedback).toBeUndefined();
  });

  it('the final confirmed itinerary actually contains activities matching the real travellers — not just culture/gastronomy', async () => {
    await engine.run(TRIP_ID);
    // Two merge attempts each save an 'orchestrator' proposal — take the last
    // one (the post-retry, rebalanced itinerary), not the first (rejected) one.
    const calls = vi.mocked(stateManager.saveProposal).mock.calls.filter(
      (c) => (c[0] as { agent: string }).agent === 'orchestrator',
    );
    expect(calls.length).toBeGreaterThan(0);
    const content = (calls[calls.length - 1]![0] as { content: Record<string, unknown> }).content;
    const itinerary = content['itinerary'] as Array<Record<string, unknown>>;
    const categories = itinerary.flatMap((d) => (d['activities'] as Array<Record<string, unknown>>) ?? [])
      .map((a) => a['category']);
    expect(categories).toContain('hiking');
    expect(categories).toContain('beach');
  });
});

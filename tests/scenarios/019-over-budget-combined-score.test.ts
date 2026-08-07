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
import { TRIP_ID, MOCK_TRIP, TOURIST_SLOT_RESULTS } from './helpers/workflow-fixtures';

// ── Scenario 019: FINAL_VALIDATION scores a blend, not persona fit alone ─────
//
// Trip shape taken from 01d32b07 (Barcelona + Dublin, 2 travellers, €2200).
// Before this work, FINAL_VALIDATION's score was 100% persona-category
// matching: budget never entered it (ConstraintChecker's budget branch was dead
// code — the validator route hardcoded `constraints: {}`) and logistics had no
// representation at all. So an itinerary could confirm while being over budget
// or full of transport downgrades, as long as it matched personas.
//
// This asserts the orchestrator now sends the real cost and the logistics
// compliance signals to the validator, and that a budget-driven low score is
// attributed to budget rather than persona fit — so the retry does not ask the
// merge to add *more* activities to an itinerary that is already too expensive.
//
// NOTE: finance is still a hard gate at FINANCE_VALIDATE, so a trip that blows
// its budget outright loops there and never reaches FINAL_VALIDATION at all.
// Making finance a genuine soft veto (and pausing for the user instead of
// re-merging blind) is the separate follow-up; this scenario deliberately has
// finance approve so the scoring path under test is actually exercised.

const OVER_BUDGET_TRIP = {
  ...MOCK_TRIP,
  name: 'Barcelona & Dublin on a tight budget',
  destinations: [
    { country: 'Spain', city: 'Barcelona', nights: 4 },
    { country: 'Ireland', city: 'Dublin', nights: 4 },
  ],
  travellers: [
    { id: 't1', preferences: { persona: 'action' } },
    { id: 't2', preferences: { persona: 'gastronomy' } },
  ],
  budgetTotal: 2200,
  budgetCurrency: 'EUR',
  dateInput: { mode: 'fixed', startDate: '2026-09-10', endDate: '2026-09-18' },
};

const ROUTE: RouteGraph = {
  orderedLegs: [],
  cityStays: [
    {
      city: 'Barcelona', country: 'Spain', arrivalDate: '2026-09-10', departureDate: '2026-09-14',
      nights: 4, timeWindows: [], sleepPoint: 'El Born', budgetPerPersonPerNight: 60,
    },
    {
      city: 'Dublin', country: 'Ireland', arrivalDate: '2026-09-14', departureDate: '2026-09-18',
      nights: 4, timeWindows: [], sleepPoint: 'Temple Bar', budgetPerPersonPerNight: 60,
    },
  ],
  totalTransportCostEurPerPerson: 193,
  totalDurationDays: 8,
};

const BUDGET: BudgetPlan = {
  perBlock: [
    { city: 'Barcelona', transportCostEurPerPerson: 0, accommodationBudgetEurPerPerson: 240, experiencesBudgetEurPerPerson: 200, totalEurPerPerson: 440 },
    { city: 'Dublin', transportCostEurPerPerson: 193, accommodationBudgetEurPerPerson: 240, experiencesBudgetEurPerPerson: 227, totalEurPerPerson: 660 },
  ],
  totalEurPerPerson: 1100,
  grandTotal: 2200,
  feasible: true,
  bufferPct: 10,
  currency: 'EUR',
};

const MERGED = {
  accommodation: [],
  itinerary: [
    { day: 1, city: 'Barcelona', country: 'Spain', activities: [
      { time: 'morning', activity: 'Sagrada Família', venue: 'Sagrada Família', category: 'history', estimatedCostPerPerson: 26 },
    ] },
    { day: 5, city: 'Dublin', country: 'Ireland', activities: [
      { time: 'evening', activity: 'Seafood tasting', venue: 'Klaw', category: 'gastronomy', estimatedCostPerPerson: 45 },
    ] },
  ],
  _financeApproved: true,
  _budgetFeasible: true,
};

describe('Scenario 019 — WorkflowEngine v2: over-budget trip scores on a blend instead of looping on a binary finance gate', () => {
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

    vi.mocked(stateManager.getTrip).mockResolvedValue(OVER_BUDGET_TRIP as never);
    vi.mocked(stateManager.saveWorkflowContext).mockImplementation(async (_, ctx) => {
      savedContexts.push(ctx as unknown as Record<string, unknown>);
    });
    vi.mocked(agentCaller.callLogisticsPlan).mockResolvedValue(JSON.parse(JSON.stringify(ROUTE)) as RouteGraph);
    vi.mocked(agentCaller.callFinanceEstimate).mockResolvedValue(BUDGET);
    vi.mocked(agentCaller.callPreferenceAgentSlots).mockResolvedValue(TOURIST_SLOT_RESULTS);
    vi.mocked(agentCaller.callOrchestratorMerge).mockResolvedValue({
      content: JSON.parse(JSON.stringify(MERGED)) as Record<string, unknown>,
      latencyMs: 250_000,
      tokensUsed: 40_000,
    });
    // Finance approves (so FINAL_VALIDATION is reached) but reports a real cost
    // meaningfully above budget — exactly the case the old persona-only score
    // would have confirmed without ever noticing.
    vi.mocked(agentCaller.callFinanceAgent).mockResolvedValue({
      content: {
        verdict: { approved: true, budgetFeasible: true, issues: [] },
        budgetBreakdown: { grandTotal: 4400, budgetTotal: 2200, suggestedCuts: [] },
      },
      latencyMs: 45_000,
      tokensUsed: 32_000,
    });
    vi.mocked(agentCaller.callValidatorAgent).mockResolvedValue({
      content: {
        scoring: { overallScore: 59, scores: [
          { travellerId: 't1', label: 'Vitor', score: 55 },
          { travellerId: 't2', label: 'Joana', score: 58 },
        ] },
        compliance: {
          personaScore: 100, financeScore: 0, logisticsScore: 100,
          combinedScore: 59, cappedByBudget: true,
        },
      },
      latencyMs: 200,
      tokensUsed: 0,
    });
  });

  it('sends the real cost and budget to the validator so the budget axis can be scored', async () => {
    await engine.run(TRIP_ID);

    const call = vi.mocked(agentCaller.callValidatorAgent).mock.calls[0];
    expect(call).toBeDefined();
    const compliance = call![4] as { finance?: { budgetTotal: number; actualTotal: number } };
    expect(compliance.finance).toEqual({ budgetTotal: 2200, actualTotal: 4400 });
  });

  it('sends logistics compliance alongside finance — logistics had no representation in scoring before', async () => {
    await engine.run(TRIP_ID);

    const compliance = vi.mocked(agentCaller.callValidatorAgent).mock.calls[0]![4] as {
      logistics?: { transportDowngrades: number; restrictionWarnings: number; weatherRisk: string };
    };
    expect(compliance.logistics).toBeDefined();
    expect(compliance.logistics).toMatchObject({
      transportDowngrades: expect.any(Number),
      restrictionWarnings: expect.any(Number),
    });
  });

  it('attributes the low score to budget, not to persona fit', async () => {
    await engine.run(TRIP_ID);

    const withFeedback = savedContexts.find((c) => c['scoreFeedback'] !== undefined) as
      { scoreFeedback?: { primaryCause?: string }; scoreBreakdown?: Record<string, unknown> } | undefined;
    expect(withFeedback?.scoreFeedback?.primaryCause).toBe('budget');
    expect(withFeedback?.scoreBreakdown).toMatchObject({
      personaScore: 100, financeScore: 0, cappedByBudget: true,
    });
  });

  it('does not ask the merge to add more persona content to an already over-budget itinerary', async () => {
    await engine.run(TRIP_ID);

    const contexts = vi.mocked(agentCaller.callOrchestratorMerge).mock.calls.map((c) => c[5] as string);
    for (const ctx of contexts) {
      expect(ctx).not.toContain('PERSONA REBALANCE RETRY');
    }
  });

  // Finance approved, so there is no financeFeedback to build a cost-cutting
  // instruction from, and the persona instruction is suppressed because the
  // cause is budget — without a dedicated budget instruction the re-merge would
  // run with no guidance at all and produce the same itinerary again.
  it('carries a budget instruction into the re-merge instead of retrying blind', async () => {
    await engine.run(TRIP_ID);

    // executeMerge issues one call per city (Barcelona + Dublin), so the retry's
    // calls are the later ones — compare the first attempt against the last.
    const contexts = vi.mocked(agentCaller.callOrchestratorMerge).mock.calls.map((c) => c[5] as string);
    expect(contexts.length).toBeGreaterThan(2);

    expect(contexts[0]).not.toContain('BUDGET TIGHTENING RETRY');

    const lastContext = contexts[contexts.length - 1]!;
    expect(lastContext).toContain('BUDGET TIGHTENING RETRY');
    expect(lastContext).toContain('4400');
    expect(lastContext).toContain('2200');
  });
});

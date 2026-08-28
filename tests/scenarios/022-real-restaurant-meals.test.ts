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
    callLogisticsPricingOverlay: vi.fn(),
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
  FINANCE_APPROVED_RESULT, VALIDATION_PASS_RESULT,
} from './helpers/workflow-fixtures';

// ── Scenario 022: real restaurant meals in the merged itinerary ──────────────
//
// Beta testers saw an empty "Meals" box per day in the trip-summary PDF: the
// logistics pricing overlay only ever injected an unnamed cost line into
// `day.meals`. The overlay now assigns MEALS_PER_DAY real named restaurants per
// day for that day's city (Porto here), rotating through the city's picks, and
// falls back to a single cost-only "Local restaurants" line for a city it found
// no restaurants for (Lisbon here — e.g. Places quota exhausted mid-run).
//
// Invariants:
//  1. The trip still completes to `confirmed`.
//  2. The persisted merged proposal's Porto day carries named Lunch/Dinner
//     restaurant meals; the Lisbon day carries the cost-only fallback line.
//  3. FINANCE_VALIDATE still receives a numeric per-person cost on every meal
//     entry — the budget maths is unchanged by the naming.

const MEALS_TRIP = {
  ...MOCK_TRIP,
  name: 'porto + lisbon with real restaurant picks',
};

const PORTO_MEALS = [
  { type: 'Lunch', name: 'Cervejaria Brasão', location: 'Baixa', rating: 4.5, estimatedCostPerPerson: 25, isEstimate: false, source: 'google_places_price_level' },
  { type: 'Dinner', name: 'Cantinho do Avillez', location: 'Cedofeita', rating: 4.6, estimatedCostPerPerson: 45, isEstimate: false, source: 'google_places_price_level' },
];
const FALLBACK_MEAL = { type: 'Meals', name: 'Local restaurants', estimatedCostPerPerson: 50, isEstimate: true, source: 'heuristic_estimate' };

describe('Scenario 022 — real restaurant meals in the merged itinerary', () => {
  let stateManager: StateManager;
  let agentCaller: AgentCaller;
  let engine: WorkflowEngine;

  beforeEach(() => {
    vi.clearAllMocks();
    stateManager = new StateManager();
    agentCaller = new AgentCaller();
    engine = new WorkflowEngine(new WorkflowStateMachine(), stateManager, agentCaller, new EventPublisher());

    vi.mocked(stateManager.getTrip).mockResolvedValue(MEALS_TRIP as never);
    vi.mocked(agentCaller.callLogisticsPlan).mockResolvedValue(ROUTE_GRAPH_NO_LEGS);
    vi.mocked(agentCaller.callFinanceEstimate).mockResolvedValue(BUDGET_PLAN_FEASIBLE);
    vi.mocked(agentCaller.callPreferenceAgentSlots).mockResolvedValue(TOURIST_SLOT_RESULTS);
    vi.mocked(agentCaller.callOrchestratorMerge).mockResolvedValue({
      content: MERGED_ITINERARY_CONTENT, latencyMs: 350, tokensUsed: 800,
    });
    vi.mocked(agentCaller.callValidatorAgent).mockResolvedValue(VALIDATION_PASS_RESULT);
    vi.mocked(agentCaller.callFinanceAgent).mockResolvedValue(FINANCE_APPROVED_RESULT as never);

    // The overlay mirrors the real one: named picks for the city it "found"
    // restaurants for, a cost-only line for the one it did not.
    vi.mocked(agentCaller.callLogisticsPricingOverlay).mockImplementation(
      (async (_tripId: string, itinerary: Array<Record<string, unknown>>) => {
        const priced = itinerary.map((day) => ({
          ...day,
          meals: day['city'] === 'Porto' ? PORTO_MEALS : [FALLBACK_MEAL],
        }));
        return {
          itinerary: priced,
          accommodation: [],
          repricedCount: 0,
          mealsNamedCount: priced.reduce(
            (n, d) => n + (Array.isArray(d.meals) && d.meals[0]?.name !== 'Local restaurants' ? d.meals.length : 0),
            0,
          ),
        };
      }) as never,
    );
  });

  function mergedProposal(): Record<string, unknown> {
    const call = vi.mocked(stateManager.saveProposal).mock.calls.find(
      (c) => (c[0] as { agent: string }).agent === 'orchestrator',
    );
    expect(call).toBeDefined();
    return (call![0] as { content: Record<string, unknown> }).content;
  }

  function financeReviewedItinerary(): Array<Record<string, unknown>> {
    const call = vi.mocked(agentCaller.callFinanceAgent).mock.calls[0]!;
    return (call[2] as { itinerary: Array<Record<string, unknown>> }).itinerary;
  }

  it('completes to confirmed', async () => {
    await engine.run(TRIP_ID);
    expect(stateManager.transitionStatus).toHaveBeenCalledWith(TRIP_ID, 'confirmed');
  });

  it('persists named Lunch/Dinner restaurant meals for the city with picks', async () => {
    await engine.run(TRIP_ID);

    const days = mergedProposal()['itinerary'] as Array<Record<string, unknown>>;
    const porto = days.find((d) => d['city'] === 'Porto')!;
    const meals = porto['meals'] as Array<Record<string, unknown>>;

    expect(meals.map((m) => m['type'])).toEqual(['Lunch', 'Dinner']);
    expect(meals.map((m) => m['name'])).toEqual(['Cervejaria Brasão', 'Cantinho do Avillez']);
    expect(meals[0]!['location']).toBe('Baixa');
  });

  it('falls back to a single cost-only line for the city with no picks', async () => {
    await engine.run(TRIP_ID);

    const days = mergedProposal()['itinerary'] as Array<Record<string, unknown>>;
    const lisbon = days.find((d) => d['city'] === 'Lisbon')!;
    const meals = lisbon['meals'] as Array<Record<string, unknown>>;

    expect(meals).toHaveLength(1);
    expect(meals[0]).toMatchObject({ name: 'Local restaurants', estimatedCostPerPerson: 50 });
  });

  it('gives finance a numeric per-person cost on every meal entry', async () => {
    await engine.run(TRIP_ID);

    const meals = financeReviewedItinerary().flatMap((d) => (d['meals'] as Array<Record<string, unknown>>) ?? []);
    expect(meals.length).toBeGreaterThan(0);
    for (const meal of meals) {
      expect(typeof meal['estimatedCostPerPerson']).toBe('number');
    }
  });
});

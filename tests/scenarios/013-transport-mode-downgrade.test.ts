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
  TOURIST_SLOT_RESULTS, MERGED_ITINERARY_CONTENT, FINANCE_APPROVED_RESULT, VALIDATION_PASS_RESULT,
} from './helpers/workflow-fixtures';

// ── Scenario 013: preferred transport mode unavailable → downgrade ─────────────
//
// Trip prefers 'flight'. Logistics returns only a train option on the Porto→Lisbon
// leg. TransportPriorityEngine (real, not mocked) should detect no flight offers
// and downgrade to train. The WorkflowEngine persists this in context.transportPriority.
// The flow must still complete normally — downgrade is not an error.

const FLIGHT_PREFERRED_TRIP = {
  ...MOCK_TRIP,
  transportPreference: 'flight',
};

const ROUTE_WITH_TRAIN_ONLY: RouteGraph = {
  orderedLegs: [
    {
      from: 'Porto',
      to: 'Lisbon',
      departureDate: '2026-09-13',
      // Only train available — no flight options
      bestOption: { mode: 'train', durationMinutes: 195, priceEur: 35, warnings: [] },
      alternatives: [],
      totalCostEurPerPerson: 35,
    },
  ],
  cityStays: [
    {
      city: 'Porto', country: 'Portugal', arrivalDate: '2026-09-10', departureDate: '2026-09-13',
      nights: 3, timeWindows: [], sleepPoint: 'Ribeira', budgetPerPersonPerNight: 80,
    },
    {
      city: 'Lisbon', country: 'Portugal', arrivalDate: '2026-09-13', departureDate: '2026-09-16',
      nights: 3, timeWindows: [], sleepPoint: 'Chiado', budgetPerPersonPerNight: 90,
    },
  ],
  totalTransportCostEurPerPerson: 35,
  totalDurationDays: 6,
};

describe('Scenario 013 — WorkflowEngine v2: transport mode downgrade', () => {
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

    vi.mocked(stateManager.getTrip).mockResolvedValue(FLIGHT_PREFERRED_TRIP as never);
    vi.mocked(stateManager.saveWorkflowContext).mockImplementation(async (_, ctx) => {
      savedContexts.push(ctx as unknown as Record<string, unknown>);
    });
    vi.mocked(agentCaller.callLogisticsPlan).mockResolvedValue(ROUTE_WITH_TRAIN_ONLY);
    vi.mocked(agentCaller.callFinanceEstimate).mockResolvedValue(BUDGET_PLAN_FEASIBLE);
    vi.mocked(agentCaller.callPreferenceAgentSlots).mockResolvedValue(TOURIST_SLOT_RESULTS);
    vi.mocked(agentCaller.callOrchestratorMerge).mockResolvedValue({
      content: MERGED_ITINERARY_CONTENT, latencyMs: 350, tokensUsed: 800,
    });
    vi.mocked(agentCaller.callFinanceAgent).mockResolvedValue(FINANCE_APPROVED_RESULT);
    vi.mocked(agentCaller.callValidatorAgent).mockResolvedValue(VALIDATION_PASS_RESULT);
  });

  it('flow still completes to FINISH despite transport downgrade', async () => {
    await engine.run(TRIP_ID);
    expect(stateManager.transitionStatus).toHaveBeenCalledWith(TRIP_ID, 'confirmed');
  });

  it('transportPriority.wasPreferenceHonored is false in saved context', async () => {
    await engine.run(TRIP_ID);

    const logisticsPhaseContext = savedContexts.find(
      (c) => c['transportPriority'] !== undefined,
    ) as { transportPriority?: { wasPreferenceHonored?: boolean; selectedMode?: string; downgradeReason?: string } } | undefined;

    expect(logisticsPhaseContext).toBeDefined();
    expect(logisticsPhaseContext!.transportPriority!.wasPreferenceHonored).toBe(false);
  });

  it('selected transport mode is train (not flight)', async () => {
    await engine.run(TRIP_ID);

    const ctx = savedContexts.find((c) => c['transportPriority'] !== undefined) as
      { transportPriority?: { selectedMode?: string } } | undefined;

    expect(ctx!.transportPriority!.selectedMode).toBe('train');
  });

  it('downgradeReason is set explaining why flight was not chosen', async () => {
    await engine.run(TRIP_ID);

    const ctx = savedContexts.find((c) => c['transportPriority'] !== undefined) as
      { transportPriority?: { downgradeReason?: string } } | undefined;

    expect(ctx!.transportPriority!.downgradeReason).toBeTruthy();
    expect(typeof ctx!.transportPriority!.downgradeReason).toBe('string');
  });

  it('downgrade reason surfaces in the merged proposal transport warnings (visible to the user)', async () => {
    await engine.run(TRIP_ID);

    const call = vi.mocked(stateManager.saveProposal).mock.calls.find(
      (c) => (c[0] as { agent: string }).agent === 'orchestrator',
    );
    expect(call).toBeDefined();
    const content = (call![0] as { content: Record<string, unknown> }).content;
    const itinerary = content['itinerary'] as Array<Record<string, unknown>>;
    // Lisbon starts on day 4 (Porto has 3 nights) — that is the transit day.
    const day4 = itinerary.find((d) => d['day'] === 4)!;
    const transport = (day4['transport'] as Array<Record<string, unknown>>)[0];
    const warnings = transport['warnings'] as string[];
    expect(warnings.some((w) => w.includes('flight preference not used'))).toBe(true);
  });
});

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
    RABBITMQ_DEFAULT_USER: 'itinera',
    RABBITMQ_DEFAULT_PASS: 'pass',
    RABBITMQ_HOST: 'localhost',
    RABBITMQ_PORT: 5672,
    PORT: 3001,
    POSTGRES_PASSWORD: 'pass',
    JWT_SECRET: 'test-secret',
    MAX_ROUNDS: 6,
    PREFERENCE_AGENT_URL: 'http://preference-agent:3002',
    ORCHESTRATOR_AGENT_URL: 'http://orchestrator-agent:3003',
    FINANCE_AGENT_URL: 'http://finance-agent:3004',
    LOGISTICS_AGENT_URL: 'http://logistics-agent:3005',
    VALIDATOR_URL: 'http://validator:3006',
  },
  getRabbitMQUrl: () => 'amqp://localhost',
}));

vi.mock('@/services/StateManager');
vi.mock('@/services/AgentCaller');
vi.mock('@/services/EventPublisher');
vi.mock('@/services/TripService');

import { NegotiationLoop } from '@/services/NegotiationLoop';
import { StateManager } from '@/services/StateManager';
import { AgentCaller } from '@/services/AgentCaller';
import { EventPublisher } from '@/services/EventPublisher';
import { TripService } from '@/services/TripService';

const BASE = { reasoning: 'r', latencyMs: 200, tokensUsed: 100 };

const FINANCE_APPROVED = { ...BASE, content: { verdict: { approved: true, budgetFeasible: true, issues: [], reasoning: 'within budget' } } };
const FINANCE_BLOCKED = { ...BASE, content: { verdict: { approved: false, budgetFeasible: true, issues: ['Over budget by 200 EUR'], reasoning: 'over budget' } } };
const FINANCE_IMPOSSIBLE = { ...BASE, content: { verdict: { approved: false, budgetFeasible: false, issues: ['Budget is unrealistic for this trip'], reasoning: 'impossible' } } };

const LOGISTICS_APPROVED = { ...BASE, content: { verdict: { approved: true, warnings: [], reasoning: 'feasible' } } };
const LOGISTICS_BLOCKED = { ...BASE, content: { verdict: { approved: false, warnings: ['Day 2: long travel leg (~5h)'], reasoning: 'infeasible' } } };

const PROPOSAL_RESULT = { ...BASE, content: { itinerary: [{ day: 1, city: 'Paris', activities: [] }] } };
const VALIDATION_RESULT = { ...BASE, content: { scoring: { overallScore: 82 } } };

const TRIP_ID = '550e8400-e29b-41d4-a716-446655440000';

const MOCK_TRIP = {
  id: TRIP_ID,
  name: 'Paris Weekend',
  region: 'Paris, France',
  ownerId: 'user-1',
  owner: { id: 'user-1', email: 'alice@example.com', name: 'Alice Smith' },
  travellers: [],
  proposals: [],
  metrics: [],
  destinations: [],
  budgetTotal: 1500,
  budgetCurrency: 'EUR',
  startDate: new Date('2026-07-01'),
  endDate: new Date('2026-07-03'),
  status: 'draft',
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('NegotiationLoop', () => {
  let stateManager: StateManager;
  let agentCaller: AgentCaller;
  let eventPublisher: EventPublisher;
  let tripService: TripService;
  let loop: NegotiationLoop;

  beforeEach(() => {
    vi.clearAllMocks();
    stateManager = new StateManager();
    agentCaller = new AgentCaller();
    eventPublisher = new EventPublisher();
    tripService = new TripService(stateManager, null as never);
    loop = new NegotiationLoop(stateManager, agentCaller, eventPublisher);
    loop.setTripService(tripService);

    vi.mocked(tripService.resolveFlexibleDates).mockResolvedValue(undefined);

    vi.mocked(stateManager.claimNegotiating).mockResolvedValue(true);
    vi.mocked(stateManager.transitionStatus).mockResolvedValue(undefined);
    vi.mocked(stateManager.saveProposal).mockResolvedValue(undefined as never);
    vi.mocked(stateManager.logAgentCall).mockResolvedValue(undefined);
    vi.mocked(stateManager.saveMetric).mockResolvedValue(undefined);
    vi.mocked(stateManager.saveFinalMetric).mockResolvedValue(undefined);
    vi.mocked(stateManager.rejectTrip).mockResolvedValue(undefined);
    vi.mocked(stateManager.getTrip).mockResolvedValue(MOCK_TRIP as never);

    vi.mocked(agentCaller.callPreferenceAgent).mockResolvedValue(PROPOSAL_RESULT);
    vi.mocked(agentCaller.callOrchestratorAgent).mockResolvedValue(PROPOSAL_RESULT);
    vi.mocked(agentCaller.callOrchestratorPropose).mockResolvedValue(PROPOSAL_RESULT);
    vi.mocked(agentCaller.callOrchestratorRefine).mockResolvedValue(PROPOSAL_RESULT);
    vi.mocked(agentCaller.callFinanceAgent).mockResolvedValue(FINANCE_APPROVED);
    vi.mocked(agentCaller.callLogisticsAgent).mockResolvedValue(LOGISTICS_APPROVED);
    vi.mocked(agentCaller.callValidatorAgent).mockResolvedValue(VALIDATION_RESULT);
    vi.mocked(agentCaller.callTransportLegs).mockResolvedValue({});

    vi.mocked(eventPublisher.publish).mockResolvedValue(undefined);
    vi.mocked(eventPublisher.publishToExchange).mockResolvedValue(undefined);
  });

  // ── Happy path / convergence ─────────────────────────────────────

  it('converges in round 4 when finance and logistics both approve immediately', async () => {
    await loop.run(TRIP_ID);

    expect(stateManager.transitionStatus).toHaveBeenCalledWith(TRIP_ID, 'confirmed');
    expect(agentCaller.callPreferenceAgent).toHaveBeenCalledTimes(4);
    expect(agentCaller.callOrchestratorAgent).toHaveBeenCalledTimes(1);
    expect(agentCaller.callOrchestratorPropose).toHaveBeenCalledTimes(1);
    expect(agentCaller.callFinanceAgent).toHaveBeenCalledTimes(1);
    expect(agentCaller.callLogisticsAgent).toHaveBeenCalledTimes(1);
    expect(agentCaller.callValidatorAgent).toHaveBeenCalledTimes(1);
    // Converged first try → no refinement needed.
    expect(agentCaller.callOrchestratorRefine).not.toHaveBeenCalled();
  });

  it('calls finance and logistics together each negotiation round', async () => {
    await loop.run(TRIP_ID);

    expect(agentCaller.callFinanceAgent).toHaveBeenCalled();
    expect(agentCaller.callLogisticsAgent).toHaveBeenCalled();
    // Same round number passed to both.
    const fRound = vi.mocked(agentCaller.callFinanceAgent).mock.calls[0][1];
    const lRound = vi.mocked(agentCaller.callLogisticsAgent).mock.calls[0][1];
    expect(fRound).toBe(lRound);
  });

  it('saves a final metric with convergence data on success', async () => {
    await loop.run(TRIP_ID);

    expect(stateManager.saveFinalMetric).toHaveBeenCalledTimes(1);
    const params = vi.mocked(stateManager.saveFinalMetric).mock.calls[0][0];
    expect(params.forcedConvergence).toBe(false);
    expect(params.financeBlockCount).toBe(0);
    expect(params.logisticsBlockCount).toBe(0);
    expect(params.consensusScore).toBe(82);
    expect(params.totalTokensUsed).toBeGreaterThan(0);
  });

  // ── Iteration ────────────────────────────────────────────────────

  it('keeps refining until both agents approve, then confirms', async () => {
    vi.mocked(agentCaller.callFinanceAgent)
      .mockResolvedValueOnce(FINANCE_BLOCKED) // round 4 blocks
      .mockResolvedValue(FINANCE_APPROVED);   // round 5 approves
    // logistics approves throughout

    await loop.run(TRIP_ID);

    expect(agentCaller.callFinanceAgent).toHaveBeenCalledTimes(2);
    expect(agentCaller.callOrchestratorRefine).toHaveBeenCalledTimes(1);
    expect(stateManager.transitionStatus).toHaveBeenCalledWith(TRIP_ID, 'confirmed');

    const params = vi.mocked(stateManager.saveFinalMetric).mock.calls[0][0];
    expect(params.financeBlockCount).toBe(1);
    expect(params.forcedConvergence).toBe(false);
  });

  it('passes combined feedback (issues + remainingRounds) into the refine call', async () => {
    vi.mocked(agentCaller.callFinanceAgent)
      .mockResolvedValueOnce(FINANCE_BLOCKED)
      .mockResolvedValue(FINANCE_APPROVED);

    await loop.run(TRIP_ID);

    const refineArgs = vi.mocked(agentCaller.callOrchestratorRefine).mock.calls[0];
    const feedbackText = refineArgs[3] as string;
    expect(feedbackText).toContain('Over budget by 200 EUR');
    expect(feedbackText).toContain('remaining');
  });

  // ── Forced convergence ───────────────────────────────────────────

  it('forces convergence at MAX_ROUNDS and still confirms when budget is feasible', async () => {
    vi.mocked(agentCaller.callFinanceAgent).mockResolvedValue(FINANCE_BLOCKED);

    await loop.run(TRIP_ID);

    // Rounds 4,5,6 → 3 finance calls; refine after rounds 4 and 5 only.
    expect(agentCaller.callFinanceAgent).toHaveBeenCalledTimes(3);
    expect(agentCaller.callOrchestratorRefine).toHaveBeenCalledTimes(2);
    expect(stateManager.transitionStatus).toHaveBeenCalledWith(TRIP_ID, 'confirmed');

    const params = vi.mocked(stateManager.saveFinalMetric).mock.calls[0][0];
    expect(params.forcedConvergence).toBe(true);
    expect(params.financeBlockCount).toBe(3);
  });

  // ── Budget reject ────────────────────────────────────────────────

  it('rejects the trip when the budget is impossible even after refinement', async () => {
    vi.mocked(agentCaller.callFinanceAgent).mockResolvedValue(FINANCE_IMPOSSIBLE);

    await loop.run(TRIP_ID);

    expect(stateManager.rejectTrip).toHaveBeenCalledWith(TRIP_ID, expect.stringContaining('unrealistic'));
    expect(stateManager.transitionStatus).not.toHaveBeenCalledWith(TRIP_ID, 'confirmed');
    // No itinerary-ready notification for a rejected trip.
    expect(eventPublisher.publishToExchange).not.toHaveBeenCalled();
  });

  it('publishes a negotiation_complete event marked rejected', async () => {
    vi.mocked(agentCaller.callFinanceAgent).mockResolvedValue(FINANCE_IMPOSSIBLE);

    await loop.run(TRIP_ID);

    const completeCall = vi.mocked(eventPublisher.publish).mock.calls.find(
      ([, , event]) => (event.content as Record<string, unknown>)['type'] === 'negotiation_complete',
    );
    expect(completeCall).toBeDefined();
    expect((completeCall![2].content as Record<string, unknown>)['rejected']).toBe(true);
  });

  // ── Real-time events ─────────────────────────────────────────────

  it('publishes a round_complete event for each negotiation round', async () => {
    vi.mocked(agentCaller.callFinanceAgent).mockResolvedValue(FINANCE_BLOCKED);

    await loop.run(TRIP_ID);

    const roundEvents = vi.mocked(eventPublisher.publish).mock.calls.filter(
      ([, , event]) => (event.content as Record<string, unknown>)['type'] === 'round_complete',
    );
    expect(roundEvents.length).toBe(3); // rounds 4,5,6
  });

  // ── Logging / failure ────────────────────────────────────────────

  it('logs each agent call with latencyMs and tokensUsed', async () => {
    await loop.run(TRIP_ID);

    const logCalls = vi.mocked(stateManager.logAgentCall).mock.calls;
    expect(logCalls.length).toBeGreaterThan(0);
    for (const [params] of logCalls) {
      expect(params.latencyMs).toBeGreaterThanOrEqual(0);
      expect(params.tokensUsed).toBe(100);
    }
  });

  it('transitions to cancelled when a round fails, does not throw', async () => {
    vi.mocked(agentCaller.callPreferenceAgent).mockRejectedValue(new Error('preference-agent unreachable'));

    await loop.run(TRIP_ID);

    expect(stateManager.transitionStatus).toHaveBeenCalledWith(TRIP_ID, 'cancelled');
    expect(stateManager.transitionStatus).not.toHaveBeenCalledWith(TRIP_ID, 'confirmed');
  });

  it('skips run when claimNegotiating returns false (already claimed)', async () => {
    vi.mocked(stateManager.claimNegotiating).mockResolvedValue(false);

    await loop.run(TRIP_ID);

    expect(agentCaller.callPreferenceAgent).not.toHaveBeenCalled();
    expect(stateManager.transitionStatus).not.toHaveBeenCalled();
  });

  // ── Notification ─────────────────────────────────────────────────

  it('publishes itinerary-ready notification on successful confirm', async () => {
    await loop.run(TRIP_ID);

    expect(eventPublisher.publishToExchange).toHaveBeenCalledOnce();
    const [exchange, routingKey, payload] = vi.mocked(eventPublisher.publishToExchange).mock.calls[0];
    expect(exchange).toBe('notifications');
    expect(routingKey).toBe('notification.email.itinerary-ready');
    expect((payload as Record<string, unknown>)['to']).toBe('alice@example.com');
  });

  it('skips notification gracefully when trip has no owner email', async () => {
    vi.mocked(stateManager.getTrip).mockResolvedValue({
      ...MOCK_TRIP,
      owner: { id: 'user-1', email: '', name: 'Alice Smith' },
    } as never);

    await loop.run(TRIP_ID);

    expect(eventPublisher.publishToExchange).not.toHaveBeenCalled();
    expect(stateManager.transitionStatus).toHaveBeenCalledWith(TRIP_ID, 'confirmed');
  });

  // ── Flexible dates ───────────────────────────────────────────────

  it('resolves flexible dates from the first logistics assessment', async () => {
    const dateInput = { mode: 'flexible' as const, days: 7, preferredMonth: '2026-07', window: 'moderate' as const };
    vi.mocked(stateManager.getTrip).mockResolvedValue({ ...MOCK_TRIP, dateInput } as never);
    vi.mocked(agentCaller.callLogisticsAgent).mockResolvedValue({
      ...LOGISTICS_APPROVED,
      content: {
        verdict: { approved: true, warnings: [], reasoning: 'feasible' },
        suggestedDates: { startDate: '2026-07-10', endDate: '2026-07-17', rationale: 'Best weather window.' },
      },
    });

    await loop.run(TRIP_ID);

    expect(tripService.resolveFlexibleDates).toHaveBeenCalledWith(TRIP_ID, '2026-07-10', '2026-07-17');
  });

  it('does NOT resolve flexible dates when mode is fixed', async () => {
    const dateInput = { mode: 'fixed' as const, startDate: '2026-07-01', endDate: '2026-07-08' };
    vi.mocked(stateManager.getTrip).mockResolvedValue({ ...MOCK_TRIP, dateInput } as never);

    await loop.run(TRIP_ID);

    expect(tripService.resolveFlexibleDates).not.toHaveBeenCalled();
  });

  // ── G1: transport pre-resolution ─────────────────────────────────

  it('G1: callTransportLegs is called before propose when trip has multiple destinations', async () => {
    vi.mocked(stateManager.getTrip).mockResolvedValue({
      ...MOCK_TRIP,
      destinations: [
        { city: 'Comporta', country: 'PT', nights: 3 },
        { city: 'Barcelona', country: 'ES', nights: 4 },
      ],
    } as never);

    await loop.run(TRIP_ID);

    expect(agentCaller.callTransportLegs).toHaveBeenCalledOnce();
    const [destinations, preference] = vi.mocked(agentCaller.callTransportLegs).mock.calls[0]!;
    expect(destinations).toHaveLength(2);
    expect(destinations[0]!.city).toBe('Comporta');
    expect(preference).toBe('best');
  });

  it('G1: callTransportLegs is NOT called for single-destination trips', async () => {
    // MOCK_TRIP has destinations:[] (treated as single destination)
    await loop.run(TRIP_ID);
    expect(agentCaller.callTransportLegs).not.toHaveBeenCalled();
  });

  // ── G3: cityTransition overwritten by real transport data ─────────

  it('G3: logistics transport options override LLM-invented cityTransition in merged proposal', async () => {
    vi.mocked(agentCaller.callOrchestratorPropose).mockResolvedValue({
      ...PROPOSAL_RESULT,
      content: {
        itinerary: [{
          day: 1, city: 'Mertola', cityTransition: { to: 'Barcelona', travelTime: 'direct train 3h (invented)' },
          activities: [],
        }],
      },
    });
    vi.mocked(agentCaller.callLogisticsAgent).mockResolvedValue({
      ...LOGISTICS_APPROVED,
      content: {
        verdict: { approved: true, warnings: [], reasoning: 'feasible' },
        transportOptions: {
          '1': [{ mode: 'flight', provider: 'TAP', durationMinutes: 120, priceEur: 95, warnings: [] }],
        },
      },
    });

    await loop.run(TRIP_ID);

    // The proposal passed to finance should have the real transport data
    const financeCall = vi.mocked(agentCaller.callFinanceAgent).mock.calls[0]!;
    const proposalPassedToFinance = financeCall[2] as Record<string, unknown>;
    const itinerary = proposalPassedToFinance['itinerary'] as Array<Record<string, unknown>>;
    const day1 = itinerary?.[0] as Record<string, unknown> | undefined;
    const cityTransition = day1?.['cityTransition'] as Record<string, unknown> | undefined;
    // cityTransition should now be from real transport data (flight 2h), not the invented "direct train 3h"
    expect(String(cityTransition?.['travelTime'] ?? '')).toContain('2h');
    expect(String(cityTransition?.['travelTime'] ?? '')).not.toContain('invented');
  });
});

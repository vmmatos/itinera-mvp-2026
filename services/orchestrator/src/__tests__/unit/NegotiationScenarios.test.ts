/**
 * Card #79 scenario tests at the negotiation-loop level.
 *
 * These assert the measurable negotiation signal (convergence rounds, who blocks
 * and how often, forced convergence) that is the core of the research thesis.
 * Agent reasoning quality is covered separately by tests/scenarios/*.
 */
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

const BASE = { reasoning: 'r', latencyMs: 50, tokensUsed: 100 };
const financeVerdict = (approved: boolean, budgetFeasible = true) =>
  ({ ...BASE, content: { verdict: { approved, budgetFeasible, issues: approved ? [] : ['Over budget by 150 EUR'], reasoning: 'finance' } } });
const logisticsVerdict = (approved: boolean) =>
  ({ ...BASE, content: { verdict: { approved, warnings: approved ? [] : ['Day 2: rain risk on outdoor activity'], reasoning: 'logistics' } } });

const SETUP = { ...BASE, content: { itinerary: [{ day: 1, city: 'Sintra', activities: [] }] } };
const VALIDATION = { ...BASE, content: { scoring: { overallScore: 80 } } };

const TRIP_ID = '550e8400-e29b-41d4-a716-446655440000';
const MOCK_TRIP = {
  id: TRIP_ID, name: 'Sintra', region: 'Sintra, Portugal', ownerId: 'u1',
  owner: { id: 'u1', email: 'a@b.com', name: 'Alice' },
  travellers: [], proposals: [], metrics: [], destinations: [],
  budgetTotal: 600, budgetCurrency: 'EUR', startDate: new Date('2026-07-01'), endDate: new Date('2026-07-03'),
  status: 'draft', createdAt: new Date(), updatedAt: new Date(),
};

describe('Negotiation scenarios (#79)', () => {
  let stateManager: StateManager;
  let agentCaller: AgentCaller;
  let loop: NegotiationLoop;

  const finalMetric = () => vi.mocked(stateManager.saveFinalMetric).mock.calls[0][0];

  beforeEach(() => {
    vi.clearAllMocks();
    stateManager = new StateManager();
    agentCaller = new AgentCaller();
    const eventPublisher = new EventPublisher();
    const tripService = new TripService(stateManager, null as never);
    loop = new NegotiationLoop(stateManager, agentCaller, eventPublisher);
    loop.setTripService(tripService);

    vi.mocked(stateManager.claimNegotiating).mockResolvedValue(true);
    vi.mocked(stateManager.transitionStatus).mockResolvedValue(undefined);
    vi.mocked(stateManager.saveProposal).mockResolvedValue(undefined as never);
    vi.mocked(stateManager.logAgentCall).mockResolvedValue(undefined);
    vi.mocked(stateManager.saveMetric).mockResolvedValue(undefined);
    vi.mocked(stateManager.saveFinalMetric).mockResolvedValue(undefined);
    vi.mocked(stateManager.rejectTrip).mockResolvedValue(undefined);
    vi.mocked(stateManager.getTrip).mockResolvedValue(MOCK_TRIP as never);

    vi.mocked(agentCaller.callPreferenceAgent).mockResolvedValue(SETUP);
    vi.mocked(agentCaller.callOrchestratorAgent).mockResolvedValue(SETUP);
    vi.mocked(agentCaller.callOrchestratorPropose).mockResolvedValue(SETUP);
    vi.mocked(agentCaller.callOrchestratorRefine).mockResolvedValue(SETUP);
    vi.mocked(agentCaller.callValidatorAgent).mockResolvedValue(VALIDATION);
    vi.mocked(eventPublisher.publish).mockResolvedValue(undefined);
    vi.mocked(eventPublisher.publishToExchange).mockResolvedValue(undefined);
  });

  it('001 compatible / normal budget: converges on the first negotiation round', async () => {
    vi.mocked(agentCaller.callFinanceAgent).mockResolvedValue(financeVerdict(true));
    vi.mocked(agentCaller.callLogisticsAgent).mockResolvedValue(logisticsVerdict(true));

    await loop.run(TRIP_ID);

    const m = finalMetric();
    expect(m.forcedConvergence).toBe(false);
    // Round 4 is the earliest possible convergence (see the comment on
    // FIRST_NEGOTIATION_ROUND in NegotiationLoop.ts): the 3-round setup
    // preamble (preferences/analyze/propose) didn't exist when issue #79 was
    // written, so its "<=3 rounds" bound maps to "converges on the first
    // negotiation evaluation, no refinement needed" — exactly this case.
    expect(m.convergenceRounds).toBe(4);
    expect(m.financeBlockCount).toBe(0);
    expect(m.logisticsBlockCount).toBe(0);
    expect(stateManager.transitionStatus).toHaveBeenCalledWith(TRIP_ID, 'confirmed');
  });

  it('002 conflicting preferences: converges within 5 rounds after one round of blocking', async () => {
    // Both agents object to the first proposal (conflicting group preferences),
    // then approve once the Orchestrator refines — converges at round 5, one
    // round short of the AC's <=5 bound.
    vi.mocked(agentCaller.callFinanceAgent)
      .mockResolvedValueOnce(financeVerdict(false))
      .mockResolvedValue(financeVerdict(true));
    vi.mocked(agentCaller.callLogisticsAgent)
      .mockResolvedValueOnce(logisticsVerdict(false))
      .mockResolvedValue(logisticsVerdict(true));

    await loop.run(TRIP_ID);

    const m = finalMetric();
    expect(m.forcedConvergence).toBe(false);
    expect(m.convergenceRounds).toBeLessThanOrEqual(5);
    expect(m.financeBlockCount).toBe(1);
    expect(m.logisticsBlockCount).toBe(1);
    expect(stateManager.transitionStatus).toHaveBeenCalledWith(TRIP_ID, 'confirmed');
  });

  it('002 conflicting preferences (harder conflict): still converges by MAX_ROUNDS, not forced', async () => {
    // A deeper conflict needs two refinement rounds — convergence lands on the
    // last available round, but it's a genuine agreement (not a forced one),
    // since both verdicts flip to approved in that same round.
    vi.mocked(agentCaller.callFinanceAgent)
      .mockResolvedValueOnce(financeVerdict(false))
      .mockResolvedValueOnce(financeVerdict(false))
      .mockResolvedValue(financeVerdict(true));
    vi.mocked(agentCaller.callLogisticsAgent)
      .mockResolvedValueOnce(logisticsVerdict(false))
      .mockResolvedValueOnce(logisticsVerdict(false))
      .mockResolvedValue(logisticsVerdict(true));

    await loop.run(TRIP_ID);

    const m = finalMetric();
    expect(m.convergenceRounds).toBe(6);
    expect(m.forcedConvergence).toBe(false);
    expect(m.financeBlockCount).toBe(2);
    expect(m.logisticsBlockCount).toBe(2);
    expect(stateManager.transitionStatus).toHaveBeenCalledWith(TRIP_ID, 'confirmed');
  });

  it('003 tight budget: Finance blocks at least 2 rounds before converging', async () => {
    vi.mocked(agentCaller.callFinanceAgent)
      .mockResolvedValueOnce(financeVerdict(false))
      .mockResolvedValueOnce(financeVerdict(false))
      .mockResolvedValue(financeVerdict(true));
    vi.mocked(agentCaller.callLogisticsAgent).mockResolvedValue(logisticsVerdict(true));

    await loop.run(TRIP_ID);

    const m = finalMetric();
    expect(m.financeBlockCount).toBeGreaterThanOrEqual(2);
    expect(stateManager.transitionStatus).toHaveBeenCalledWith(TRIP_ID, 'confirmed');
  });

  it('004 rain forecast: Logistics blocks at least 1 round', async () => {
    vi.mocked(agentCaller.callFinanceAgent).mockResolvedValue(financeVerdict(true));
    vi.mocked(agentCaller.callLogisticsAgent)
      .mockResolvedValueOnce(logisticsVerdict(false))
      .mockResolvedValue(logisticsVerdict(true));

    await loop.run(TRIP_ID);

    const m = finalMetric();
    expect(m.logisticsBlockCount).toBeGreaterThanOrEqual(1);
    expect(stateManager.transitionStatus).toHaveBeenCalledWith(TRIP_ID, 'confirmed');
  });

  it('006 vegan + fine dining: converges once both agents approve', async () => {
    // Conflict resolved after one refinement round.
    vi.mocked(agentCaller.callFinanceAgent)
      .mockResolvedValueOnce(financeVerdict(false))
      .mockResolvedValue(financeVerdict(true));
    vi.mocked(agentCaller.callLogisticsAgent)
      .mockResolvedValueOnce(logisticsVerdict(false))
      .mockResolvedValue(logisticsVerdict(true));

    await loop.run(TRIP_ID);

    const m = finalMetric();
    expect(m.forcedConvergence).toBe(false);
    expect(m.convergenceRounds).toBeLessThanOrEqual(6);
    expect(stateManager.transitionStatus).toHaveBeenCalledWith(TRIP_ID, 'confirmed');
  });

  it('impossible budget: forced convergence ends in rejection, not confirmation', async () => {
    vi.mocked(agentCaller.callFinanceAgent).mockResolvedValue(financeVerdict(false, false));
    vi.mocked(agentCaller.callLogisticsAgent).mockResolvedValue(logisticsVerdict(true));

    await loop.run(TRIP_ID);

    const m = finalMetric();
    expect(m.forcedConvergence).toBe(true);
    expect(stateManager.rejectTrip).toHaveBeenCalled();
    expect(stateManager.transitionStatus).not.toHaveBeenCalledWith(TRIP_ID, 'confirmed');
  });
});

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

import { NegotiationLoop } from '@/services/NegotiationLoop';
import { StateManager } from '@/services/StateManager';
import { AgentCaller } from '@/services/AgentCaller';
import { EventPublisher } from '@/services/EventPublisher';

const AGENT_RESULT = {
  content: { destination: 'paris' },
  reasoning: 'good fit',
  latencyMs: 200,
  tokensUsed: 100,
};

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
  let loop: NegotiationLoop;

  beforeEach(() => {
    vi.clearAllMocks();
    stateManager = new StateManager();
    agentCaller = new AgentCaller();
    eventPublisher = new EventPublisher();
    loop = new NegotiationLoop(stateManager, agentCaller, eventPublisher);

    vi.mocked(stateManager.claimNegotiating).mockResolvedValue(true);
    vi.mocked(stateManager.transitionStatus).mockResolvedValue(undefined);
    vi.mocked(stateManager.saveProposal).mockResolvedValue(undefined);
    vi.mocked(stateManager.logAgentCall).mockResolvedValue(undefined);
    vi.mocked(stateManager.saveMetric).mockResolvedValue(undefined);
    vi.mocked(stateManager.getTrip).mockResolvedValue(MOCK_TRIP as never);

    vi.mocked(agentCaller.callPreferenceAgent).mockResolvedValue(AGENT_RESULT);
    vi.mocked(agentCaller.callOrchestratorAgent).mockResolvedValue(AGENT_RESULT);
    vi.mocked(agentCaller.callOrchestratorPropose).mockResolvedValue(AGENT_RESULT);
    vi.mocked(agentCaller.callFinanceAgent).mockResolvedValue(AGENT_RESULT);
    vi.mocked(agentCaller.callLogisticsAgent).mockResolvedValue(AGENT_RESULT);
    vi.mocked(agentCaller.callValidatorAgent).mockResolvedValue(AGENT_RESULT);

    vi.mocked(eventPublisher.publishToExchange).mockResolvedValue(undefined);
  });

  it('happy path: runs all 6 rounds and transitions to confirmed', async () => {
    await loop.run(TRIP_ID);

    expect(stateManager.claimNegotiating).toHaveBeenCalledWith(TRIP_ID);
    expect(stateManager.transitionStatus).toHaveBeenCalledWith(TRIP_ID, 'confirmed');
    expect(agentCaller.callPreferenceAgent).toHaveBeenCalledTimes(4);
    expect(agentCaller.callOrchestratorAgent).toHaveBeenCalledTimes(1);
    expect(agentCaller.callOrchestratorPropose).toHaveBeenCalledTimes(1);
    expect(agentCaller.callFinanceAgent).toHaveBeenCalledTimes(1);
    expect(agentCaller.callLogisticsAgent).toHaveBeenCalledTimes(1);
    expect(agentCaller.callValidatorAgent).toHaveBeenCalledTimes(1);
  });

  it('saves a metric after each round', async () => {
    await loop.run(TRIP_ID);

    expect(stateManager.saveMetric).toHaveBeenCalledTimes(6);
  });

  it('logs each agent call with latencyMs and tokensUsed', async () => {
    await loop.run(TRIP_ID);

    const logCalls = vi.mocked(stateManager.logAgentCall).mock.calls;
    for (const [params] of logCalls) {
      expect(params.latencyMs).toBeGreaterThanOrEqual(0);
      expect(params.tokensUsed).toBe(100);
    }
  });

  it('transitions to cancelled when a round fails, does not throw', async () => {
    vi.mocked(agentCaller.callPreferenceAgent).mockRejectedValue(
      new Error('preference-agent unreachable'),
    );

    await loop.run(TRIP_ID);

    expect(stateManager.transitionStatus).toHaveBeenCalledWith(TRIP_ID, 'cancelled');
    expect(stateManager.transitionStatus).not.toHaveBeenCalledWith(TRIP_ID, 'confirmed');
  });

  it('transitions to cancelled when StateManager.saveMetric throws', async () => {
    vi.mocked(stateManager.saveMetric).mockRejectedValueOnce(new Error('db error'));

    await loop.run(TRIP_ID);

    expect(stateManager.transitionStatus).toHaveBeenCalledWith(TRIP_ID, 'cancelled');
  });

  it('does not throw even if cancelled transition also fails', async () => {
    vi.mocked(agentCaller.callPreferenceAgent).mockRejectedValue(new Error('network'));
    vi.mocked(stateManager.transitionStatus)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('db unavailable'));

    await expect(loop.run(TRIP_ID)).resolves.toBeUndefined();
  });

  it('skips run when claimNegotiating returns false (already claimed)', async () => {
    vi.mocked(stateManager.claimNegotiating).mockResolvedValue(false);

    await loop.run(TRIP_ID);

    expect(agentCaller.callPreferenceAgent).not.toHaveBeenCalled();
    expect(stateManager.transitionStatus).not.toHaveBeenCalled();
  });

  // ── Notification tests ────────────────────────────────────────────

  it('publishes itinerary-ready notification with owner email on successful confirm', async () => {
    await loop.run(TRIP_ID);

    expect(eventPublisher.publishToExchange).toHaveBeenCalledOnce();
    const [exchange, routingKey, payload] = vi.mocked(eventPublisher.publishToExchange).mock.calls[0];
    expect(exchange).toBe('notifications');
    expect(routingKey).toBe('notification.email.itinerary-ready');
    expect((payload as Record<string, unknown>)['type']).toBe('itinerary-ready');
    expect((payload as Record<string, unknown>)['to']).toBe('alice@example.com');
    const data = (payload as Record<string, unknown>)['data'] as Record<string, unknown>;
    expect(data['firstName']).toBe('Alice');
    expect(data['tripName']).toBe('Paris Weekend');
    expect(data['tripId']).toBe(TRIP_ID);
  });

  it('does NOT publish notification when trip fails (cancelled)', async () => {
    vi.mocked(agentCaller.callPreferenceAgent).mockRejectedValue(
      new Error('preference-agent unreachable'),
    );

    await loop.run(TRIP_ID);

    expect(eventPublisher.publishToExchange).not.toHaveBeenCalled();
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
});

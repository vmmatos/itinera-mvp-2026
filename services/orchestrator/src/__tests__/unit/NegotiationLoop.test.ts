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

import { NegotiationLoop } from '@/services/NegotiationLoop';
import { StateManager } from '@/services/StateManager';
import { AgentCaller } from '@/services/AgentCaller';

const AGENT_RESULT = {
  content: { destination: 'paris' },
  reasoning: 'good fit',
  latencyMs: 200,
  tokensUsed: 100,
};

const TRIP_ID = '550e8400-e29b-41d4-a716-446655440000';

describe('NegotiationLoop', () => {
  let stateManager: StateManager;
  let agentCaller: AgentCaller;
  let loop: NegotiationLoop;

  beforeEach(() => {
    vi.clearAllMocks();
    stateManager = new StateManager();
    agentCaller = new AgentCaller();
    loop = new NegotiationLoop(stateManager, agentCaller);

    vi.mocked(stateManager.claimNegotiating).mockResolvedValue(true);
    vi.mocked(stateManager.transitionStatus).mockResolvedValue(undefined);
    vi.mocked(stateManager.saveProposal).mockResolvedValue(undefined);
    vi.mocked(stateManager.logAgentCall).mockResolvedValue(undefined);
    vi.mocked(stateManager.saveMetric).mockResolvedValue(undefined);
    vi.mocked(stateManager.getTrip).mockResolvedValue(null);

    vi.mocked(agentCaller.callPreferenceAgent).mockResolvedValue(AGENT_RESULT);
    vi.mocked(agentCaller.callOrchestratorAgent).mockResolvedValue(AGENT_RESULT);
    vi.mocked(agentCaller.callOrchestratorPropose).mockResolvedValue(AGENT_RESULT);
    vi.mocked(agentCaller.callFinanceAgent).mockResolvedValue(AGENT_RESULT);
    vi.mocked(agentCaller.callLogisticsAgent).mockResolvedValue(AGENT_RESULT);
    vi.mocked(agentCaller.callValidatorAgent).mockResolvedValue(AGENT_RESULT);
  });

  it('happy path: runs all 6 rounds and transitions to confirmed', async () => {
    await loop.run(TRIP_ID);

    expect(stateManager.claimNegotiating).toHaveBeenCalledWith(TRIP_ID);
    expect(stateManager.transitionStatus).toHaveBeenCalledWith(TRIP_ID, 'confirmed');
    expect(agentCaller.callPreferenceAgent).toHaveBeenCalledTimes(4);
    expect(agentCaller.callOrchestratorAgent).toHaveBeenCalledTimes(1);     // analyze round
    expect(agentCaller.callOrchestratorPropose).toHaveBeenCalledTimes(1);  // propose round
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
});

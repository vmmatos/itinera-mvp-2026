import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@itinera/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@itinera/shared')>();
  return {
    ...actual,
    createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  };
});

vi.mock('@/config', () => ({
  config: {
    PREFERENCE_AGENT_URL: 'http://preference-agent:3002',
    ORCHESTRATOR_AGENT_URL: 'http://orchestrator-agent:3003',
    FINANCE_AGENT_URL: 'http://finance-agent:3004',
    LOGISTICS_AGENT_URL: 'http://logistics-agent:3005',
    VALIDATOR_URL: 'http://validator:3006',
  },
}));

import { AgentCaller } from '@/services/AgentCaller';

const MOCK_RESULT = {
  content: { proposal: 'paris trip' },
  reasoning: 'good destination',
  latencyMs: 300,
  tokensUsed: 150,
};

let fetchMock: ReturnType<typeof vi.fn>;

describe('AgentCaller', () => {
  let caller: AgentCaller;

  beforeEach(() => {
    vi.clearAllMocks();
    caller = new AgentCaller();
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(MOCK_RESULT),
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('callPreferenceAgent: posts to correct URL and returns result', async () => {
    const result = await caller.callPreferenceAgent('trip-1', 'alice', 1);

    expect(fetchMock).toHaveBeenCalledWith(
      'http://preference-agent:3002/api/v1/preferences/negotiate',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ tripId: 'trip-1', agentName: 'alice', round: 1 }),
      }),
    );
    expect(result).toEqual(MOCK_RESULT);
  });

  it('callOrchestratorAgent: posts to correct URL with proposals', async () => {
    await caller.callOrchestratorAgent('trip-1', 2, [{ dest: 'paris' }]);

    expect(fetchMock).toHaveBeenCalledWith(
      'http://orchestrator-agent:3003/api/v1/orchestrate/analyze',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('callFinanceAgent: posts to correct URL', async () => {
    await caller.callFinanceAgent('trip-1', 3, { budget: 5000 });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://finance-agent:3004/api/v1/finance/evaluate',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('callLogisticsAgent: posts to correct URL', async () => {
    await caller.callLogisticsAgent('trip-1', 4, { destination: 'paris' });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://logistics-agent:3005/api/v1/logistics/evaluate',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('callValidatorAgent: posts to correct URL', async () => {
    await caller.callValidatorAgent('trip-1', 5, { destination: 'paris' });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://validator:3006/api/v1/validate',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('throws when agent returns non-ok response', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve('internal server error'),
    });

    await expect(
      caller.callPreferenceAgent('trip-1', 'alice', 1),
    ).rejects.toThrow('preference-agent returned 500');
  });

  it('throws when fetch itself rejects (network error)', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(
      caller.callPreferenceAgent('trip-1', 'alice', 1),
    ).rejects.toThrow('ECONNREFUSED');
  });
});

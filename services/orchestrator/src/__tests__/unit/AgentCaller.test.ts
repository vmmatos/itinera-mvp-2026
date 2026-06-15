import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@itinera/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@itinera/shared')>();
  return {
    ...actual,
    createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  };
});

vi.mock('jsonwebtoken', () => ({
  default: { sign: vi.fn().mockReturnValue('mock-service-token') },
}));

vi.mock('@/config', () => ({
  config: {
    JWT_SECRET: 'test-secret',
    JWT_ISSUER: 'itinera',
    PREFERENCE_AGENT_URL: 'http://preference-agent:3002',
    ORCHESTRATOR_AGENT_URL: 'http://orchestrator-agent:3003',
    FINANCE_AGENT_URL: 'http://finance-agent:3004',
    LOGISTICS_AGENT_URL: 'http://logistics-agent:3005',
    VALIDATOR_URL: 'http://validator:3006',
  },
}));

import { AgentCaller } from '@/services/AgentCaller';

const AGENT_EVENT = {
  content: { proposal: 'paris trip' },
  reasoning: 'good destination',
  metrics: { latencyMs: 300, tokensUsed: 150 },
};

const AGENT_RESULT = {
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
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('callPreferenceAgent: posts to /propose with correct body', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ proposals: [AGENT_EVENT] }),
    });

    const result = await caller.callPreferenceAgent('trip-1', 'alice', 1);

    expect(fetchMock).toHaveBeenCalledWith(
      'http://preference-agent:3002/propose',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ tripId: 'trip-1', round: 1, agents: ['alice'], context: '' }),
        headers: expect.objectContaining({ Authorization: 'Bearer mock-service-token' }),
      }),
    );
    expect(result.content).toEqual(AGENT_RESULT.content);
    expect(result.reasoning).toBe(AGENT_RESULT.reasoning);
    expect(result.tokensUsed).toBe(AGENT_RESULT.tokensUsed);
  });

  it('callOrchestratorAgent: posts to /analyze with proposals', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ analysis: AGENT_EVENT }),
    });

    await caller.callOrchestratorAgent('trip-1', 2, [{ dest: 'paris' }]);

    expect(fetchMock).toHaveBeenCalledWith(
      'http://orchestrator-agent:3003/analyze',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('callFinanceAgent: posts to /review with budget context', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ review: AGENT_EVENT }),
    });

    await caller.callFinanceAgent('trip-1', 3, { budget: 5000 }, { budgetTotal: 3000, budgetCurrency: 'EUR' });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://finance-agent:3004/review',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"budgetTotal":3000'),
      }),
    );
  });

  it('callFinanceAgent: coerces string budgetTotal to number', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ review: AGENT_EVENT }),
    });

    await caller.callFinanceAgent('trip-1', 3, {}, { budgetTotal: '3000.00' as unknown as number, budgetCurrency: 'EUR' });

    const sentBody = JSON.parse(fetchMock.mock.calls[0][1].body as string) as Record<string, unknown>;
    expect(typeof sentBody['budgetTotal']).toBe('number');
    expect(sentBody['budgetTotal']).toBe(3000);
  });

  it('callLogisticsAgent: posts to /validate with region', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ validation: AGENT_EVENT }),
    });

    await caller.callLogisticsAgent('trip-1', 4, { destination: 'paris' }, { region: 'Paris, France' });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://logistics-agent:3005/validate',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"region":"Paris, France"'),
      }),
    );
  });

  it('callValidatorAgent: posts to / with tripId, round, proposal', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(AGENT_RESULT),
    });

    const result = await caller.callValidatorAgent('trip-1', 5, { destination: 'paris' });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://validator:3006/',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(result).toEqual(AGENT_RESULT);
  });

  it('includes Authorization header on all calls', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ proposals: [AGENT_EVENT] }),
    });

    await caller.callPreferenceAgent('trip-1', 'alice', 1);

    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer mock-service-token' }),
      }),
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

  it('callLogisticsAgent: includes dateInput in body when provided', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ validation: AGENT_EVENT }),
    });

    const dateInput = { mode: 'flexible' as const, days: 7, preferredMonth: '2026-07', window: 'moderate' as const };
    await caller.callLogisticsAgent('trip-1', 4, {}, { region: 'Portugal', dateInput });

    const sentBody = JSON.parse(fetchMock.mock.calls[0][1].body as string) as Record<string, unknown>;
    expect(sentBody['dateInput']).toEqual(dateInput);
  });

  it('callLogisticsAgent: sends null dateInput when not provided', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ validation: AGENT_EVENT }),
    });

    await caller.callLogisticsAgent('trip-1', 4, {}, { region: 'Portugal' });

    const sentBody = JSON.parse(fetchMock.mock.calls[0][1].body as string) as Record<string, unknown>;
    expect(sentBody['dateInput']).toBeNull();
  });

  it('callFinanceAgent: includes dateInput in body when provided', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ review: AGENT_EVENT }),
    });

    const dateInput = { mode: 'flexible' as const, days: 5, preferredMonth: '2026-08', window: 'open' as const };
    await caller.callFinanceAgent('trip-1', 3, {}, { budgetTotal: 3000, budgetCurrency: 'EUR', dateInput });

    const sentBody = JSON.parse(fetchMock.mock.calls[0][1].body as string) as Record<string, unknown>;
    expect(sentBody['dateInput']).toEqual(dateInput);
  });
});

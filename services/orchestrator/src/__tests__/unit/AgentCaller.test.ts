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
      json: () => Promise.resolve({ review: AGENT_EVENT }),
    });

    await caller.callFinanceAgent('trip-1', 3, { budget: 5000 }, { budgetTotal: 3000, budgetCurrency: 'EUR' });

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
      caller.callFinanceAgent('trip-1', 3, { budget: 5000 }, { budgetTotal: 3000, budgetCurrency: 'EUR' }),
    ).rejects.toThrow('finance returned 500');
  });

  it('throws when fetch itself rejects (network error)', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(
      caller.callFinanceAgent('trip-1', 3, { budget: 5000 }, { budgetTotal: 3000, budgetCurrency: 'EUR' }),
    ).rejects.toThrow('ECONNREFUSED');
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

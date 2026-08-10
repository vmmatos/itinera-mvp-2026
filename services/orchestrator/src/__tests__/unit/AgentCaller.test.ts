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
    AGENT_CALL_TIMEOUT_MS: 360000,
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

  it('callValidatorAgent: forwards the trip-level brief so every traveller is scored against it', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(AGENT_RESULT),
    });

    await caller.callValidatorAgent('trip-1', 2, {}, { mustHaves: ['museus'], avoids: ['discotecas'] });

    const sentBody = JSON.parse(fetchMock.mock.calls[0][1].body as string) as Record<string, unknown>;
    expect(sentBody['groupPreferences']).toEqual({ mustHaves: ['museus'], avoids: ['discotecas'] });
  });

  it('callValidatorAgent: omits the brief for a caller that has none', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(AGENT_RESULT),
    });

    await caller.callValidatorAgent('trip-1', 2, {});

    const sentBody = JSON.parse(fetchMock.mock.calls[0][1].body as string) as Record<string, unknown>;
    expect(sentBody['groupPreferences']).toBeUndefined();
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

  it('callLogisticsRestrictions: posts to /restrictions with tripId, itinerary, region, dateInput', async () => {
    const warnings = [
      { day: 1, activityName: 'Jerónimos Monastery', warningType: 'public_holiday', message: '⚠ closed' },
    ];
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ warnings }),
    });

    const dateInput = { mode: 'fixed' as const, startDate: '2026-06-10', endDate: '2026-06-12' };
    const result = await caller.callLogisticsRestrictions(
      'trip-1', [{ day: 1, activities: [] }], 'Lisbon, Portugal', dateInput,
    );

    expect(fetchMock).toHaveBeenCalledWith(
      'http://logistics-agent:3005/restrictions',
      expect.objectContaining({ method: 'POST' }),
    );
    const sentBody = JSON.parse(fetchMock.mock.calls[0][1].body as string) as Record<string, unknown>;
    expect(sentBody['tripId']).toBe('trip-1');
    expect(sentBody['region']).toBe('Lisbon, Portugal');
    expect(sentBody['dateInput']).toEqual(dateInput);
    expect(result).toEqual(warnings);
  });

  it('callLogisticsRestrictions: defaults region to "unknown" when null', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ warnings: [] }),
    });

    await caller.callLogisticsRestrictions('trip-1', [], null, null);

    const sentBody = JSON.parse(fetchMock.mock.calls[0][1].body as string) as Record<string, unknown>;
    expect(sentBody['region']).toBe('unknown');
  });

  it('callLogisticsRestrictions: throws when logistics-agent returns non-ok response', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve('internal server error'),
    });

    await expect(
      caller.callLogisticsRestrictions('trip-1', [], 'Paris', null),
    ).rejects.toThrow('logistics returned 500');
  });

  it('callLogisticsWeatherAssessment: posts to /weather-assessment with tripId, round, itinerary, region, dateInput, restrictionWarnings', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ assessment: AGENT_EVENT }),
    });

    const dateInput = { mode: 'fixed' as const, startDate: '2026-06-10', endDate: '2026-06-12' };
    const restrictionWarnings = [
      { day: 1, activityName: 'Jerónimos Monastery', warningType: 'public_holiday' as const, message: '⚠ closed' },
    ];
    const result = await caller.callLogisticsWeatherAssessment(
      'trip-1', 1, [{ day: 1, activities: [] }], 'Lisbon, Portugal', dateInput, restrictionWarnings,
    );

    expect(fetchMock).toHaveBeenCalledWith(
      'http://logistics-agent:3005/weather-assessment',
      expect.objectContaining({ method: 'POST' }),
    );
    const sentBody = JSON.parse(fetchMock.mock.calls[0][1].body as string) as Record<string, unknown>;
    expect(sentBody['tripId']).toBe('trip-1');
    expect(sentBody['round']).toBe(1);
    expect(sentBody['region']).toBe('Lisbon, Portugal');
    expect(sentBody['dateInput']).toEqual(dateInput);
    expect(sentBody['restrictionWarnings']).toEqual(restrictionWarnings);
    expect(result).toEqual(AGENT_RESULT);
  });

  it('callLogisticsWeatherAssessment: defaults region to "unknown" when null', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ assessment: AGENT_EVENT }),
    });

    await caller.callLogisticsWeatherAssessment('trip-1', 1, [], null, null);

    const sentBody = JSON.parse(fetchMock.mock.calls[0][1].body as string) as Record<string, unknown>;
    expect(sentBody['region']).toBe('unknown');
  });

  it('callLogisticsWeatherAssessment: throws when logistics-agent returns non-ok response', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve('internal server error'),
    });

    await expect(
      caller.callLogisticsWeatherAssessment('trip-1', 1, [], 'Paris', null),
    ).rejects.toThrow('logistics returned 500');
  });
});

describe('AgentCaller — timeout and network-failure retry', () => {
  let caller: AgentCaller;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    caller = new AgentCaller();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  /** A fetch() that never settles on its own — only reacts to AbortSignal, like a real hung request. */
  function hangingFetch(): (url: string, init: RequestInit) => Promise<never> {
    return (_url, init) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')));
    });
  }

  it('aborts and throws once the call exceeds AGENT_CALL_TIMEOUT_MS', async () => {
    fetchMock.mockImplementation(hangingFetch());

    const promise = caller.callFinanceAgent('trip-1', 2, { itinerary: [] });
    const assertion = expect(promise).rejects.toThrow('finance unreachable');
    await vi.advanceTimersByTimeAsync(360000);
    await assertion;
  });

  it('does NOT retry a call with no retries configured — a network failure propagates on the first attempt', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));

    await expect(caller.callFinanceAgent('trip-1', 2, { itinerary: [] })).rejects.toThrow('finance unreachable after 1 attempt');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries callPreferenceAgentSlots up to 2 extra times on a network failure, then succeeds', async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ proposals: [] }) });

    const promise = caller.callPreferenceAgentSlots('trip-1', 1, []);
    await vi.advanceTimersByTimeAsync(2000); // backoff between attempt 1 and 2
    const result = await promise;

    expect(result).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('gives up after exhausting retries on callOrchestratorMerge — 1 initial + 2 retries, all network failures', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));

    const promise = caller.callOrchestratorMerge(
      'trip-1', 1,
      { orderedLegs: [], cityStays: [], totalTransportCostEurPerPerson: 0, totalDurationDays: 1 },
      {}, { perBlock: [], totalEurPerPerson: 0, grandTotal: 0, feasible: true, bufferPct: 0, currency: 'EUR' },
      '', 'Paris', { pace: 'medium', mustHaves: [], avoids: [] },
    );
    const assertion = expect(promise).rejects.toThrow('orchestrator-agent unreachable after 3 attempt(s)');
    await vi.advanceTimersByTimeAsync(2000);
    await vi.advanceTimersByTimeAsync(2000);
    await assertion;

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('does NOT retry on an HTTP error response even for a retry-eligible call — the downstream service already ran', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 422, text: () => Promise.resolve('bad schema') });

    await expect(caller.callPreferenceAgentSlots('trip-1', 1, [])).rejects.toThrow('preference-agent returned 422');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

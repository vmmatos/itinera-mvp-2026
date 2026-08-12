import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@itinera/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@itinera/shared')>();
  return {
    ...actual,
    createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
    buildRoutingKey: actual.buildRoutingKey,
  };
});

vi.mock('@/config', () => ({
  config: {
    ANTHROPIC_API_KEY: 'test-key',
    ANTHROPIC_MODEL: 'claude-sonnet-4-20250514',
    NODE_ENV: 'test',
    RABBITMQ_EXCHANGE: 'agent.events',
    CACHE_TTL_SECONDS: 3600,
  },
  getRabbitMQUrl: () => 'amqp://localhost',
  getRedisUrl: () => 'redis://localhost:6379',
}));

vi.mock('@/services/AnthropicService');
vi.mock('@/services/RabbitMQPublisher');
vi.mock('@/services/RedisService');
vi.mock('@/services/ProposalStorageService');

import { WeatherAnalyzer } from '@/agents/WeatherAnalyzer';
import { AnthropicService } from '@/services/AnthropicService';
import { RabbitMQPublisher } from '@/services/RabbitMQPublisher';
import { RedisService } from '@/services/RedisService';
import { ProposalStorageService } from '@/services/ProposalStorageService';
import type { WeatherForecast } from '@/services/WeatherService';
import type { TimingValidationResult } from '@/validators/TimingValidator';

const VALID_TRIP_ID = '550e8400-e29b-41d4-a716-446655440000';

const MOCK_FORECASTS: WeatherForecast[] = [
  {
    region: 'Paris',
    date: '2026-06-01',
    temperature: { min: 15, max: 25, unit: 'celsius' },
    conditions: 'Clear',
    humidity: 50,
    windSpeed: 15,
    description: 'clear sky',
    precipitationProbability: 20,
  },
];

const MOCK_TIMING: TimingValidationResult = {
  valid: true,
  conflicts: [],
  warnings: [],
};

const MOCK_ITINERARY = [
  {
    day: 1,
    date: '2026-06-01',
    activities: [{ name: 'Eiffel Tower', startTime: '10:00', endTime: '12:00', location: 'Eiffel Tower', isOutdoor: true }],
    transport: [],
  },
];

const MOCK_WEATHER_ANALYSIS = JSON.stringify({
  overallRisk: 'low',
  dayAssessments: [{ day: 1, weatherRisk: 'low', affectedActivities: [] }],
  timingIssues: [],
  summary: 'Great weather for outdoor activities.',
});

describe('WeatherAnalyzer', () => {
  let anthropic: AnthropicService;
  let publisher: RabbitMQPublisher;
  let redis: RedisService;
  let storage: ProposalStorageService;
  let analyzer: WeatherAnalyzer;

  beforeEach(() => {
    vi.clearAllMocks();
    anthropic = new AnthropicService();
    publisher = new RabbitMQPublisher();
    redis = new RedisService();
    storage = new ProposalStorageService();
    analyzer = new WeatherAnalyzer(anthropic, publisher, redis, storage);

    vi.mocked(anthropic.complete).mockResolvedValue({
      content: MOCK_WEATHER_ANALYSIS,
      latencyMs: 500,
      tokensUsed: 350,
    });
    vi.mocked(redis.get).mockResolvedValue(null);
    vi.mocked(redis.set).mockResolvedValue(undefined);
    vi.mocked(storage.save).mockResolvedValue(undefined);
    vi.mocked(publisher.publish).mockResolvedValue(undefined);
  });

  it('cache miss: calls Claude, stores and publishes event', async () => {
    const event = await analyzer.analyze(VALID_TRIP_ID, 1, MOCK_ITINERARY, MOCK_FORECASTS, MOCK_TIMING);

    expect(anthropic.complete).toHaveBeenCalledOnce();
    expect(storage.save).not.toHaveBeenCalled();
    expect(publisher.publish).toHaveBeenCalledOnce();
    expect(redis.set).toHaveBeenCalledOnce();
    expect(event.agent).toBe('logistics');
    expect(event.round).toBe(1);
    expect(event.tripId).toBe(VALID_TRIP_ID);
    expect(event.type).toBe('agent.propose');
  });

  it('cache hit: returns cached event without calling Claude', async () => {
    const cachedEvent = {
      tripId: VALID_TRIP_ID,
      type: 'agent.propose',
      agent: 'logistics',
      round: 1,
      timestamp: new Date().toISOString(),
      content: { overallRisk: 'low' },
    };
    vi.mocked(redis.get).mockResolvedValue(cachedEvent);

    const event = await analyzer.analyze(VALID_TRIP_ID, 1, MOCK_ITINERARY, MOCK_FORECASTS, MOCK_TIMING);

    expect(anthropic.complete).not.toHaveBeenCalled();
    expect(storage.save).not.toHaveBeenCalled();
    expect(event).toEqual(cachedEvent);
  });

  it('publishes with routing key agent.logistics.propose', async () => {
    await analyzer.analyze(VALID_TRIP_ID, 1, MOCK_ITINERARY, MOCK_FORECASTS, MOCK_TIMING);

    expect(publisher.publish).toHaveBeenCalledWith('agent.logistics.propose', expect.any(Object));
  });

  it('event contains latencyMs and tokensUsed', async () => {
    const event = await analyzer.analyze(VALID_TRIP_ID, 1, MOCK_ITINERARY, MOCK_FORECASTS, MOCK_TIMING);

    expect(event.metrics?.latencyMs).toBe(500);
    expect(event.metrics?.tokensUsed).toBe(350);
  });

  it('uses correct cache key per round', async () => {
    await analyzer.analyze(VALID_TRIP_ID, 3, MOCK_ITINERARY, MOCK_FORECASTS, MOCK_TIMING);

    expect(redis.get).toHaveBeenCalledWith(
      `logistics:${VALID_TRIP_ID}:weather-analyzer:3:propose`,
    );
  });

  it('includes weather and itinerary data in Claude prompt', async () => {
    await analyzer.analyze(VALID_TRIP_ID, 1, MOCK_ITINERARY, MOCK_FORECASTS, MOCK_TIMING);

    const callArg = vi.mocked(anthropic.complete).mock.calls[0];
    const callStr = JSON.stringify(callArg);
    expect(callStr).toContain('Paris');
    expect(callStr).toContain('Eiffel Tower');
    expect(callStr).toContain('Clear');
  });

  it('handles non-JSON Claude response gracefully', async () => {
    vi.mocked(anthropic.complete).mockResolvedValue({
      content: 'Weather looks fine overall.',
      latencyMs: 200,
      tokensUsed: 30,
    });

    const event = await analyzer.analyze(VALID_TRIP_ID, 1, MOCK_ITINERARY, MOCK_FORECASTS, MOCK_TIMING);

    expect(event.content).toEqual({ raw: 'Weather looks fine overall.' });
  });

  // ── Date handling ─────────────────────────────────────────────
  // Flexible trips never get a forecast, so the model is no longer asked to
  // pick a "best window" it has no data to pick from — with or without a month.

  it.each([
    ['flexible with a preferred month', { mode: 'flexible' as const, days: 7, preferredMonth: '2026-07', window: 'moderate' as const }],
    ['flexible without a preferred month', { mode: 'flexible' as const, days: 5, window: 'open' as const }],
    ['fixed', { mode: 'fixed' as const, startDate: '2026-07-01', endDate: '2026-07-08' }],
  ])('%s dateInput: never asks the model for suggestedDates', async (_label, dateInput) => {
    await analyzer.analyze(VALID_TRIP_ID, 1, MOCK_ITINERARY, MOCK_FORECASTS, MOCK_TIMING, dateInput);

    const callStr = JSON.stringify(vi.mocked(anthropic.complete).mock.calls[0]);
    expect(callStr).not.toContain('DATE SELECTION MODE');
    expect(callStr).not.toContain('suggestedDates');
  });

  it('no dateInput: never asks the model for suggestedDates', async () => {
    await analyzer.analyze(VALID_TRIP_ID, 1, MOCK_ITINERARY, MOCK_FORECASTS, MOCK_TIMING);

    const callStr = JSON.stringify(vi.mocked(anthropic.complete).mock.calls[0]);
    expect(callStr).not.toContain('DATE SELECTION MODE');
    expect(callStr).not.toContain('suggestedDates');
  });

  // Without this block the model has no calendar to date its assessments
  // against, returns null/wrong dates, and the real forecast — matched by date
  // downstream — never reaches the UI.
  // The system prompt mentions "Trip calendar" in its rules, so these assert
  // against the dynamic user message only.
  function lastUserMessage(): string {
    const [, messages] = vi.mocked(anthropic.complete).mock.calls[0] as unknown as [string, Array<{ content: string }>];
    return messages[0]?.content ?? '';
  }

  it('injects the trip calendar so the model can date its own dayAssessments', async () => {
    await analyzer.analyze(
      VALID_TRIP_ID, 1, MOCK_ITINERARY, MOCK_FORECASTS, MOCK_TIMING,
      null, undefined, undefined, ['2026-06-01', '2026-06-02'],
    );

    expect(lastUserMessage()).toContain('Trip calendar');
    expect(lastUserMessage()).toContain('day 1 → 2026-06-01');
    expect(lastUserMessage()).toContain('day 2 → 2026-06-02');
  });

  it('omits the trip calendar block when there are no trip dates', async () => {
    await analyzer.analyze(
      VALID_TRIP_ID, 1, MOCK_ITINERARY, MOCK_FORECASTS, MOCK_TIMING,
      null, undefined, undefined, [],
    );

    expect(lastUserMessage()).not.toContain('Trip calendar');
  });
});

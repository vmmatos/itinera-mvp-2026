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

import { ItineraryMerger } from '@/agents/ItineraryMerger';
import { AnthropicService } from '@/services/AnthropicService';
import { RabbitMQPublisher } from '@/services/RabbitMQPublisher';
import { RedisService } from '@/services/RedisService';
import { ProposalStorageService } from '@/services/ProposalStorageService';

const VALID_TRIP_ID = '550e8400-e29b-41d4-a716-446655440000';
const ROUTE_GRAPH = {
  orderedLegs: [],
  cityStays: [],
  totalTransportCostEurPerPerson: 0,
  totalDurationDays: 3,
};
const BUDGET_PLAN = { perBlock: [], totalEurPerPerson: 1000, grandTotal: 2000, feasible: true, bufferPct: 10, currency: 'EUR' };
const TOURIST_OUTPUTS = { alice: { activities: ['museum'] } };

const VALID_MERGE_JSON = JSON.stringify({
  accommodation: [{ city: 'Paris', name: 'Hotel Lumiere Paris', type: 'hotel', pricePerNightPerPerson: 80, nights: 3 }],
  itinerary: [{ day: 1, activities: [{ time: 'morning', activity: 'Visit Eiffel Tower', venue: 'Eiffel Tower, Champ de Mars 5', estimatedCostPerPerson: 25 }] }],
  satisfactionEstimates: { alice: 0.8 },
});

describe('ItineraryMerger', () => {
  let anthropic: AnthropicService;
  let publisher: RabbitMQPublisher;
  let redis: RedisService;
  let storage: ProposalStorageService;
  let merger: ItineraryMerger;

  beforeEach(() => {
    vi.clearAllMocks();
    anthropic = new AnthropicService();
    publisher = new RabbitMQPublisher();
    redis = new RedisService();
    storage = new ProposalStorageService();
    merger = new ItineraryMerger(anthropic, publisher, redis, storage);

    vi.mocked(redis.get).mockResolvedValue(null);
    vi.mocked(redis.set).mockResolvedValue(undefined);
    vi.mocked(storage.save).mockResolvedValue(undefined);
    vi.mocked(publisher.publish).mockResolvedValue(undefined);
  });

  it('merge: happy path returns a valid parsed itinerary', async () => {
    vi.mocked(anthropic.complete).mockResolvedValue({
      content: VALID_MERGE_JSON,
      latencyMs: 500,
      tokensUsed: 300,
      truncated: false,
    });

    const event = await merger.merge(VALID_TRIP_ID, 1, ROUTE_GRAPH, TOURIST_OUTPUTS, BUDGET_PLAN, 'Paris trip', 'Paris');

    expect(anthropic.complete).toHaveBeenCalledOnce();
    expect(event.content).toMatchObject({ itinerary: expect.any(Array) });
    expect(publisher.publish).toHaveBeenCalledOnce();
  });

  it('merge: accepts an explicit null cityTransition on non-transition days without retrying', async () => {
    const jsonWithNullCityTransition = JSON.stringify({
      accommodation: [{ city: 'Paris', name: 'Hotel Lumiere Paris', type: 'hotel', pricePerNightPerPerson: 80, nights: 3 }],
      itinerary: [
        { day: 1, cityTransition: null, activities: [{ time: 'morning', activity: 'Visit Eiffel Tower', venue: 'Eiffel Tower, Champ de Mars 5', estimatedCostPerPerson: 25 }] },
      ],
      satisfactionEstimates: { alice: 0.8 },
    });
    vi.mocked(anthropic.complete).mockResolvedValue({
      content: jsonWithNullCityTransition,
      latencyMs: 500,
      tokensUsed: 300,
      truncated: false,
    });

    const event = await merger.merge(VALID_TRIP_ID, 1, ROUTE_GRAPH, TOURIST_OUTPUTS, BUDGET_PLAN, '', 'Paris');

    expect(anthropic.complete).toHaveBeenCalledOnce();
    expect(event.content).toMatchObject({ itinerary: expect.any(Array) });
    expect(publisher.publish).toHaveBeenCalledOnce();
  });

  it('merge: uses ITINERARY_MAX_TOKENS for the completion call', async () => {
    vi.mocked(anthropic.complete).mockResolvedValue({
      content: VALID_MERGE_JSON,
      latencyMs: 500,
      tokensUsed: 300,
      truncated: false,
    });

    await merger.merge(VALID_TRIP_ID, 1, ROUTE_GRAPH, TOURIST_OUTPUTS, BUDGET_PLAN, '', 'Paris');

    expect(anthropic.complete).toHaveBeenCalledWith(
      expect.any(String), expect.any(Array), expect.objectContaining({ maxTokens: 32000 }),
    );
  });

  it('merge: retries once when output is truncated, and succeeds if the retry is valid', async () => {
    vi.mocked(anthropic.complete)
      .mockResolvedValueOnce({
        content: '{"itinerary": [{ "day": 1, "activities": [ truncated mid-object',
        latencyMs: 20000,
        tokensUsed: 32000,
        truncated: true,
      })
      .mockResolvedValueOnce({
        content: VALID_MERGE_JSON,
        latencyMs: 4000,
        tokensUsed: 5000,
        truncated: false,
      });

    const event = await merger.merge(VALID_TRIP_ID, 1, ROUTE_GRAPH, TOURIST_OUTPUTS, BUDGET_PLAN, '', 'Paris');

    expect(anthropic.complete).toHaveBeenCalledTimes(2);
    expect(event.content).toMatchObject({ itinerary: expect.any(Array) });
    expect(event.metrics?.tokensUsed).toBe(37000);
    // Retry prompt should tell the model its previous output was truncated.
    const retryCallArgs = vi.mocked(anthropic.complete).mock.calls[1];
    expect(JSON.stringify(retryCallArgs)).toContain('truncated');
  });

  it('merge: throws (never silently saves an empty/raw itinerary) when truncated output is still invalid after retry', async () => {
    vi.mocked(anthropic.complete).mockResolvedValue({
      content: '{"itinerary": [{ "day": 1, "activities": [ truncated mid-object',
      latencyMs: 20000,
      tokensUsed: 32000,
      truncated: true,
    });

    await expect(
      merger.merge(VALID_TRIP_ID, 1, ROUTE_GRAPH, TOURIST_OUTPUTS, BUDGET_PLAN, '', 'Paris'),
    ).rejects.toThrow(/failed to produce a valid itinerary/);

    expect(anthropic.complete).toHaveBeenCalledTimes(2);
    // A rejected merge must never be published or cached as if it succeeded.
    expect(publisher.publish).not.toHaveBeenCalled();
    expect(redis.set).not.toHaveBeenCalled();
  });

  it('merge: throws when Claude replies with plain non-JSON prose (not just on truncation)', async () => {
    vi.mocked(anthropic.complete).mockResolvedValue({
      content: 'Sure, here is the merged itinerary in prose form...',
      latencyMs: 300,
      tokensUsed: 80,
      truncated: false,
    });

    await expect(
      merger.merge(VALID_TRIP_ID, 1, ROUTE_GRAPH, TOURIST_OUTPUTS, BUDGET_PLAN, '', 'Paris'),
    ).rejects.toThrow(/failed to produce a valid itinerary/);

    expect(publisher.publish).not.toHaveBeenCalled();
  });
});

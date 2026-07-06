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
  },
  getRabbitMQUrl: () => 'amqp://localhost',
  getRedisUrl: () => 'redis://localhost:6379',
}));

vi.mock('@/services/AnthropicService');
vi.mock('@/services/RabbitMQPublisher');
vi.mock('@/services/RedisService');
vi.mock('@/services/ProposalStorageService');

import { ProposalRefiner } from '@/agents/ProposalRefiner';
import { AnthropicService } from '@/services/AnthropicService';
import { RabbitMQPublisher } from '@/services/RabbitMQPublisher';
import { RedisService } from '@/services/RedisService';
import { ProposalStorageService } from '@/services/ProposalStorageService';

const VALID_TRIP_ID = '550e8400-e29b-41d4-a716-446655440000';
const MOCK_PROPOSAL = { itinerary: [{ day: 1, activities: ['museum'] }] };
const MOCK_FEEDBACK = 'Carlos needs more outdoor activities on day 1';
const VALID_PROPOSAL_JSON = JSON.stringify({
  accommodation: [{ city: 'Paris', name: 'Hotel Lumiere Paris', type: 'hotel', pricePerNightPerPerson: 80, nights: 3 }],
  itinerary: [{ day: 1, activities: [{ time: 'morning', activity: 'Visit Eiffel Tower', venue: 'Eiffel Tower, Champ de Mars 5', estimatedCostPerPerson: 25 }] }],
  satisfactionEstimates: { alice: 0.8 },
  changesApplied: [],
  refinementSummary: 'done',
});

describe('ProposalRefiner', () => {
  let anthropic: AnthropicService;
  let publisher: RabbitMQPublisher;
  let redis: RedisService;
  let storage: ProposalStorageService;
  let refiner: ProposalRefiner;

  beforeEach(() => {
    vi.clearAllMocks();
    anthropic = new AnthropicService();
    publisher = new RabbitMQPublisher();
    redis = new RedisService();
    storage = new ProposalStorageService();
    refiner = new ProposalRefiner(anthropic, publisher, redis, storage);

    vi.mocked(anthropic.complete).mockResolvedValue({
      content: VALID_PROPOSAL_JSON,
      latencyMs: 500,
      tokensUsed: 250,
    });
    vi.mocked(storage.save).mockResolvedValue(undefined);
    vi.mocked(publisher.publish).mockResolvedValue(undefined);
  });

  it('refine: always calls Claude (no cache)', async () => {
    const event = await refiner.refine(VALID_TRIP_ID, 1, MOCK_PROPOSAL, MOCK_FEEDBACK, 'context');

    expect(anthropic.complete).toHaveBeenCalledOnce();
    expect(storage.save).not.toHaveBeenCalled();
    expect(publisher.publish).toHaveBeenCalledOnce();
    expect(event.agent).toBe('orchestrator');
    expect(event.round).toBe(1);
    expect(event.tripId).toBe(VALID_TRIP_ID);
    expect(event.type).toBe('agent.refine');
  });

  it('refine: never reads or writes cache', async () => {
    await refiner.refine(VALID_TRIP_ID, 1, MOCK_PROPOSAL, MOCK_FEEDBACK, 'context');

    expect(redis.get).not.toHaveBeenCalled();
    expect(redis.set).not.toHaveBeenCalled();
  });

  it('refine: publishes with routing key agent.orchestrator.refine', async () => {
    await refiner.refine(VALID_TRIP_ID, 1, MOCK_PROPOSAL, MOCK_FEEDBACK, 'context');

    expect(publisher.publish).toHaveBeenCalledWith('agent.orchestrator.refine', expect.any(Object));
  });

  it('refine: event contains latencyMs and tokensUsed', async () => {
    const event = await refiner.refine(VALID_TRIP_ID, 1, MOCK_PROPOSAL, MOCK_FEEDBACK, 'context');

    expect(event.metrics?.latencyMs).toBe(500);
    expect(event.metrics?.tokensUsed).toBe(250);
  });

  it('refine: includes proposal and feedback in Claude prompt', async () => {
    await refiner.refine(VALID_TRIP_ID, 1, MOCK_PROPOSAL, MOCK_FEEDBACK, 'Trip to Paris');

    const callArg = vi.mocked(anthropic.complete).mock.calls[0];
    const callStr = JSON.stringify(callArg);
    expect(callStr).toContain('museum');
    expect(callStr).toContain('Carlos needs more outdoor');
    expect(callStr).toContain('Trip to Paris');
  });

  it('refine: calls Claude independently each invocation (no caching between calls)', async () => {
    await refiner.refine(VALID_TRIP_ID, 1, MOCK_PROPOSAL, 'feedback 1', 'context');
    await refiner.refine(VALID_TRIP_ID, 1, MOCK_PROPOSAL, 'feedback 2', 'context');

    expect(anthropic.complete).toHaveBeenCalledTimes(2);
  });

  it('refine: handles non-JSON Claude response gracefully', async () => {
    vi.mocked(anthropic.complete).mockResolvedValue({
      content: 'here is the refined plan',
      latencyMs: 200,
      tokensUsed: 40,
    });

    const event = await refiner.refine(VALID_TRIP_ID, 1, MOCK_PROPOSAL, MOCK_FEEDBACK, '');
    expect(event.content).toEqual({ raw: 'here is the refined plan' });
  });
});

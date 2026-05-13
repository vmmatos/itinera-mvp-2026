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

import { CompromiseGenerator } from '@/agents/CompromiseGenerator';
import { AnthropicService } from '@/services/AnthropicService';
import { RabbitMQPublisher } from '@/services/RabbitMQPublisher';
import { RedisService } from '@/services/RedisService';
import { ProposalStorageService } from '@/services/ProposalStorageService';

const VALID_TRIP_ID = '550e8400-e29b-41d4-a716-446655440000';
const MOCK_CONFLICTS = {
  conflicts: [{ agents: ['alice', 'carlos'], topic: 'pace', severity: 3 }],
  consensusAreas: [],
};

describe('CompromiseGenerator', () => {
  let anthropic: AnthropicService;
  let publisher: RabbitMQPublisher;
  let redis: RedisService;
  let storage: ProposalStorageService;
  let generator: CompromiseGenerator;

  beforeEach(() => {
    vi.clearAllMocks();
    anthropic = new AnthropicService();
    publisher = new RabbitMQPublisher();
    redis = new RedisService();
    storage = new ProposalStorageService();
    generator = new CompromiseGenerator(anthropic, publisher, redis, storage);

    vi.mocked(anthropic.complete).mockResolvedValue({
      content: '{"itinerary":[],"compromiseRationale":"balanced","satisfactionEstimates":{}}',
      latencyMs: 600,
      tokensUsed: 300,
    });
    vi.mocked(redis.get).mockResolvedValue(null);
    vi.mocked(redis.set).mockResolvedValue(undefined);
    vi.mocked(storage.save).mockResolvedValue(undefined);
    vi.mocked(publisher.publish).mockResolvedValue(undefined);
  });

  it('generateCompromise: cache miss calls Claude and stores result', async () => {
    const event = await generator.generateCompromise(VALID_TRIP_ID, 1, MOCK_CONFLICTS, 'Trip to Paris');

    expect(anthropic.complete).toHaveBeenCalledOnce();
    expect(storage.save).toHaveBeenCalledOnce();
    expect(publisher.publish).toHaveBeenCalledOnce();
    expect(redis.set).toHaveBeenCalledOnce();
    expect(event.agent).toBe('orchestrator');
    expect(event.round).toBe(1);
    expect(event.tripId).toBe(VALID_TRIP_ID);
    expect(event.type).toBe('agent.propose');
  });

  it('generateCompromise: cache hit skips Claude call', async () => {
    const cachedEvent = {
      tripId: VALID_TRIP_ID,
      type: 'agent.propose',
      agent: 'orchestrator',
      round: 1,
      timestamp: new Date().toISOString(),
      content: { itinerary: [] },
    };
    vi.mocked(redis.get).mockResolvedValue(cachedEvent);

    const event = await generator.generateCompromise(VALID_TRIP_ID, 1, MOCK_CONFLICTS, 'context');

    expect(anthropic.complete).not.toHaveBeenCalled();
    expect(storage.save).not.toHaveBeenCalled();
    expect(event).toEqual(cachedEvent);
  });

  it('generateCompromise: publishes with routing key agent.orchestrator.propose', async () => {
    await generator.generateCompromise(VALID_TRIP_ID, 1, MOCK_CONFLICTS, 'context');

    expect(publisher.publish).toHaveBeenCalledWith('agent.orchestrator.propose', expect.any(Object));
  });

  it('generateCompromise: event contains latencyMs and tokensUsed', async () => {
    const event = await generator.generateCompromise(VALID_TRIP_ID, 1, MOCK_CONFLICTS, 'context');

    expect(event.metrics?.latencyMs).toBe(600);
    expect(event.metrics?.tokensUsed).toBe(300);
  });

  it('generateCompromise: includes conflict data and context in Claude prompt', async () => {
    await generator.generateCompromise(VALID_TRIP_ID, 1, MOCK_CONFLICTS, 'Trip to Paris');

    const callArg = vi.mocked(anthropic.complete).mock.calls[0];
    expect(JSON.stringify(callArg)).toContain('pace');
    expect(JSON.stringify(callArg)).toContain('Trip to Paris');
  });

  it('generateCompromise: handles non-JSON Claude response gracefully', async () => {
    vi.mocked(anthropic.complete).mockResolvedValue({
      content: 'here is a compromise itinerary',
      latencyMs: 200,
      tokensUsed: 60,
    });

    const event = await generator.generateCompromise(VALID_TRIP_ID, 1, MOCK_CONFLICTS, '');
    expect(event.content).toEqual({ raw: 'here is a compromise itinerary' });
  });

  it('generateCompromise: uses correct cache key per round', async () => {
    await generator.generateCompromise(VALID_TRIP_ID, 3, MOCK_CONFLICTS, 'context');

    expect(redis.get).toHaveBeenCalledWith(
      `orch:${VALID_TRIP_ID}:compromise-generator:3:propose`,
    );
  });
});

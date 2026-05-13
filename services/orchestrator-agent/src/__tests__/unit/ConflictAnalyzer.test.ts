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

import { ConflictAnalyzer } from '@/agents/ConflictAnalyzer';
import { AnthropicService } from '@/services/AnthropicService';
import { RabbitMQPublisher } from '@/services/RabbitMQPublisher';
import { RedisService } from '@/services/RedisService';
import { ProposalStorageService } from '@/services/ProposalStorageService';

const VALID_TRIP_ID = '550e8400-e29b-41d4-a716-446655440000';
const MOCK_PROPOSALS = [
  { agent: 'alice', content: { activities: ['museum'] } },
  { agent: 'carlos', content: { activities: ['hiking'] } },
];

describe('ConflictAnalyzer', () => {
  let anthropic: AnthropicService;
  let publisher: RabbitMQPublisher;
  let redis: RedisService;
  let storage: ProposalStorageService;
  let analyzer: ConflictAnalyzer;

  beforeEach(() => {
    vi.clearAllMocks();
    anthropic = new AnthropicService();
    publisher = new RabbitMQPublisher();
    redis = new RedisService();
    storage = new ProposalStorageService();
    analyzer = new ConflictAnalyzer(anthropic, publisher, redis, storage);

    vi.mocked(anthropic.complete).mockResolvedValue({
      content: '{"conflicts":[],"consensusAreas":[],"overallConflictScore":0}',
      latencyMs: 400,
      tokensUsed: 200,
    });
    vi.mocked(redis.get).mockResolvedValue(null);
    vi.mocked(redis.set).mockResolvedValue(undefined);
    vi.mocked(storage.save).mockResolvedValue(undefined);
    vi.mocked(publisher.publish).mockResolvedValue(undefined);
  });

  it('analyze: cache miss calls Claude and stores result', async () => {
    const event = await analyzer.analyze(VALID_TRIP_ID, 1, MOCK_PROPOSALS);

    expect(anthropic.complete).toHaveBeenCalledOnce();
    expect(storage.save).toHaveBeenCalledOnce();
    expect(publisher.publish).toHaveBeenCalledOnce();
    expect(redis.set).toHaveBeenCalledOnce();
    expect(event.agent).toBe('orchestrator');
    expect(event.round).toBe(1);
    expect(event.tripId).toBe(VALID_TRIP_ID);
    expect(event.type).toBe('agent.score');
  });

  it('analyze: cache hit skips Claude call', async () => {
    const cachedEvent = {
      tripId: VALID_TRIP_ID,
      type: 'agent.score',
      agent: 'orchestrator',
      round: 1,
      timestamp: new Date().toISOString(),
      content: { conflicts: [] },
    };
    vi.mocked(redis.get).mockResolvedValue(cachedEvent);

    const event = await analyzer.analyze(VALID_TRIP_ID, 1, MOCK_PROPOSALS);

    expect(anthropic.complete).not.toHaveBeenCalled();
    expect(storage.save).not.toHaveBeenCalled();
    expect(publisher.publish).not.toHaveBeenCalled();
    expect(event).toEqual(cachedEvent);
  });

  it('analyze: publishes with routing key agent.orchestrator.score', async () => {
    await analyzer.analyze(VALID_TRIP_ID, 1, MOCK_PROPOSALS);

    expect(publisher.publish).toHaveBeenCalledWith('agent.orchestrator.score', expect.any(Object));
  });

  it('analyze: event contains latencyMs and tokensUsed', async () => {
    const event = await analyzer.analyze(VALID_TRIP_ID, 1, MOCK_PROPOSALS);

    expect(event.metrics?.latencyMs).toBe(400);
    expect(event.metrics?.tokensUsed).toBe(200);
  });

  it('analyze: includes proposals in Claude prompt', async () => {
    await analyzer.analyze(VALID_TRIP_ID, 1, MOCK_PROPOSALS);

    const callArg = vi.mocked(anthropic.complete).mock.calls[0];
    expect(JSON.stringify(callArg)).toContain('alice');
    expect(JSON.stringify(callArg)).toContain('carlos');
  });

  it('analyze: handles non-JSON Claude response gracefully', async () => {
    vi.mocked(anthropic.complete).mockResolvedValue({
      content: 'plain text conflict summary',
      latencyMs: 300,
      tokensUsed: 50,
    });

    const event = await analyzer.analyze(VALID_TRIP_ID, 1, MOCK_PROPOSALS);
    expect(event.content).toEqual({ raw: 'plain text conflict summary' });
  });

  it('analyze: uses correct cache key per round', async () => {
    await analyzer.analyze(VALID_TRIP_ID, 2, MOCK_PROPOSALS);

    expect(redis.get).toHaveBeenCalledWith(
      `orch:${VALID_TRIP_ID}:conflict-analyzer:2:score`,
    );
  });
});

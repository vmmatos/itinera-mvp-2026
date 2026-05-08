import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AgentName } from '@itinera/shared';

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

import { BaseAgent } from '@/agents/BaseAgent';
import { AnthropicService } from '@/services/AnthropicService';
import { RabbitMQPublisher } from '@/services/RabbitMQPublisher';
import { RedisService } from '@/services/RedisService';
import { ProposalStorageService } from '@/services/ProposalStorageService';

class TestAgent extends BaseAgent {
  readonly agentName: AgentName = 'alice';
  readonly systemPrompt = 'You are Alice.';
}

describe('BaseAgent', () => {
  let anthropic: AnthropicService;
  let publisher: RabbitMQPublisher;
  let redis: RedisService;
  let storage: ProposalStorageService;
  let agent: TestAgent;

  beforeEach(() => {
    vi.clearAllMocks();
    anthropic = new AnthropicService();
    publisher = new RabbitMQPublisher();
    redis = new RedisService();
    storage = new ProposalStorageService();
    agent = new TestAgent(anthropic, publisher, redis, storage);

    vi.mocked(anthropic.complete).mockResolvedValue({
      content: '{"proposal":{}}',
      latencyMs: 500,
      tokensUsed: 150,
    });
    vi.mocked(redis.get).mockResolvedValue(null);
    vi.mocked(redis.set).mockResolvedValue(undefined);
    vi.mocked(storage.save).mockResolvedValue(undefined);
    vi.mocked(publisher.publish).mockResolvedValue(undefined);
  });

  it('propose: cache miss calls Claude and stores proposal', async () => {
    const event = await agent.propose('trip-123', 1, 'Trip to Europe');

    expect(anthropic.complete).toHaveBeenCalledOnce();
    expect(storage.save).toHaveBeenCalledOnce();
    expect(publisher.publish).toHaveBeenCalledOnce();
    expect(redis.set).toHaveBeenCalledOnce();
    expect(event.agent).toBe('alice');
    expect(event.round).toBe(1);
    expect(event.tripId).toBe('trip-123');
    expect(event.type).toBe('agent.propose');
  });

  it('propose: cache hit skips Claude call', async () => {
    const cachedEvent = {
      tripId: 'trip-123',
      type: 'agent.propose',
      agent: 'alice',
      round: 1,
      timestamp: new Date().toISOString(),
      content: { proposal: {} },
    };
    vi.mocked(redis.get).mockResolvedValue(cachedEvent);

    const event = await agent.propose('trip-123', 1, 'context');

    expect(anthropic.complete).not.toHaveBeenCalled();
    expect(storage.save).not.toHaveBeenCalled();
    expect(event).toEqual(cachedEvent);
  });

  it('propose: publishes with routing key agent.alice.propose', async () => {
    await agent.propose('trip-123', 1, 'context');

    expect(publisher.publish).toHaveBeenCalledWith('agent.alice.propose', expect.any(Object));
  });

  it('propose: event contains latencyMs and tokensUsed', async () => {
    const event = await agent.propose('trip-123', 1, 'context');

    expect(event.metrics?.latencyMs).toBe(500);
    expect(event.metrics?.tokensUsed).toBe(150);
  });

  it('react: cache miss calls Claude with proposals context', async () => {
    const proposals = [{ agent: 'bob', content: { proposal: {} } }];
    const event = await agent.react('trip-123', 1, proposals, 'context');

    expect(anthropic.complete).toHaveBeenCalledOnce();
    const callArg = vi.mocked(anthropic.complete).mock.calls[0];
    expect(JSON.stringify(callArg)).toContain('bob');
    expect(event.type).toBe('agent.refine');
  });

  it('react: publishes with routing key agent.alice.refine', async () => {
    await agent.react('trip-123', 1, [], 'context');

    expect(publisher.publish).toHaveBeenCalledWith('agent.alice.refine', expect.any(Object));
  });

  it('propose: handles non-JSON Claude response gracefully', async () => {
    vi.mocked(anthropic.complete).mockResolvedValue({
      content: 'plain text response',
      latencyMs: 300,
      tokensUsed: 50,
    });

    const event = await agent.propose('trip-123', 1, 'context');
    expect(event.content).toEqual({ raw: 'plain text response' });
  });
});

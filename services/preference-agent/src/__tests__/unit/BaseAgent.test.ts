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

  it('propose: cache miss calls Claude, publishes event (orchestrator owns DB save)', async () => {
    const event = await agent.propose('trip-123', 1, 'Trip to Europe');

    expect(anthropic.complete).toHaveBeenCalledOnce();
    expect(storage.save).not.toHaveBeenCalled(); // orchestrator saves proposals, not the agent
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

const SLOT = {
  tripId: 'trip-123', round: 1, city: 'Porto', country: 'Portugal',
  dateWindow: { start: '2026-09-10', end: '2026-09-13' },
  availableTimeSlots: [], budgetPerPersonBlock: 300, currency: 'EUR',
  mustHaves: [], avoids: [], groupSize: 2,
};

const VALID_SLOT_PROPOSALS_JSON = JSON.stringify({
  slotProposals: [
    { city: 'Porto', date: '2026-09-10', slot: 'morning', activity: 'Ribeira Market Walk', venue: 'Ribeira', estimatedCostPerPerson: 0 },
  ],
  reasoning: 'Picked a free morning activity',
});

const MULTI_SLOT_PROPOSALS_JSON = JSON.stringify({
  slotProposals: [
    { city: 'Porto', date: '2026-09-10', slot: 'morning', activity: 'Ribeira Market Walk', venue: 'Ribeira', estimatedCostPerPerson: 0 },
    { city: 'Porto', date: '2026-09-10', slot: 'afternoon', activity: 'Livraria Lello', venue: 'Livraria Lello', estimatedCostPerPerson: 8 },
  ],
  reasoning: 'Morning and afternoon covered',
});

describe('BaseAgent.proposeForSlot', () => {
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

    vi.mocked(redis.get).mockResolvedValue(null);
    vi.mocked(redis.set).mockResolvedValue(undefined);
    vi.mocked(storage.save).mockResolvedValue(undefined);
    vi.mocked(publisher.publish).mockResolvedValue(undefined);
  });

  it('happy path: returns valid parsed slotProposals', async () => {
    vi.mocked(anthropic.complete).mockResolvedValue({
      content: VALID_SLOT_PROPOSALS_JSON, latencyMs: 500, tokensUsed: 800, truncated: false,
    });

    const event = await agent.proposeForSlot('trip-123', 1, [SLOT]);

    expect(anthropic.complete).toHaveBeenCalledOnce();
    expect(event.content).toMatchObject({ slotProposals: expect.any(Array) });
  });

  it('happy path: assigns a unique id to each slot proposal (the LLM never generates one)', async () => {
    vi.mocked(anthropic.complete).mockResolvedValue({
      content: MULTI_SLOT_PROPOSALS_JSON, latencyMs: 500, tokensUsed: 800, truncated: false,
    });

    const event = await agent.proposeForSlot('trip-123', 1, [SLOT]);

    const proposals = (event.content as { slotProposals: Array<{ id: string }> }).slotProposals;
    expect(proposals).toHaveLength(2);
    for (const p of proposals) {
      expect(typeof p.id).toBe('string');
      expect(p.id.length).toBeGreaterThan(0);
    }
    expect(proposals[0]!.id).not.toBe(proposals[1]!.id);
  });

  it('uses a 16000 output-token budget for the completion call', async () => {
    vi.mocked(anthropic.complete).mockResolvedValue({
      content: VALID_SLOT_PROPOSALS_JSON, latencyMs: 500, tokensUsed: 800, truncated: false,
    });

    await agent.proposeForSlot('trip-123', 1, [SLOT]);

    expect(anthropic.complete).toHaveBeenCalledWith(
      expect.any(String), expect.any(Array), expect.objectContaining({ maxTokens: 16000 }),
    );
  });

  it('retries once when output is truncated, and succeeds if the retry is valid', async () => {
    vi.mocked(anthropic.complete)
      .mockResolvedValueOnce({
        content: '{"slotProposals": [{ "city": "Porto", "date": "2026-09-10", "slot": "morning", "activity": "Ribeira',
        latencyMs: 8000, tokensUsed: 16000, truncated: true,
      })
      .mockResolvedValueOnce({
        content: VALID_SLOT_PROPOSALS_JSON, latencyMs: 2000, tokensUsed: 1000, truncated: false,
      });

    const event = await agent.proposeForSlot('trip-123', 1, [SLOT]);

    expect(anthropic.complete).toHaveBeenCalledTimes(2);
    expect(event.content).toMatchObject({ slotProposals: expect.any(Array) });
    expect(event.metrics?.tokensUsed).toBe(17000);
    const retryCallArgs = vi.mocked(anthropic.complete).mock.calls[1];
    expect(JSON.stringify(retryCallArgs)).toContain('truncated');
  });

  it('throws (never silently saves an empty {raw} proposal set) when truncated output is still invalid after retry', async () => {
    vi.mocked(anthropic.complete).mockResolvedValue({
      content: '{"slotProposals": [{ "city": "Porto", "date": "2026-09-10", "slot": "morning", "activity": "Ribeira',
      latencyMs: 8000, tokensUsed: 16000, truncated: true,
    });

    await expect(agent.proposeForSlot('trip-123', 1, [SLOT])).rejects.toThrow(/failed to produce valid slot proposals/);

    expect(anthropic.complete).toHaveBeenCalledTimes(2);
    expect(publisher.publish).not.toHaveBeenCalled();
    expect(redis.set).not.toHaveBeenCalled();
  });

  it('throws when Claude replies with plain non-JSON prose (not just on truncation)', async () => {
    vi.mocked(anthropic.complete).mockResolvedValue({
      content: 'Sure, here are some proposals in prose form...', latencyMs: 300, tokensUsed: 80, truncated: false,
    });

    await expect(agent.proposeForSlot('trip-123', 1, [SLOT])).rejects.toThrow(/failed to produce valid slot proposals/);
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it('cache hit skips Claude entirely', async () => {
    const cachedEvent = {
      tripId: 'trip-123', type: 'agent.propose', agent: 'alice', round: 1,
      timestamp: new Date().toISOString(), content: { slotProposals: [] },
    };
    vi.mocked(redis.get).mockResolvedValue(cachedEvent);

    const event = await agent.proposeForSlot('trip-123', 1, [SLOT]);

    expect(anthropic.complete).not.toHaveBeenCalled();
    expect(event).toEqual(cachedEvent);
  });
});

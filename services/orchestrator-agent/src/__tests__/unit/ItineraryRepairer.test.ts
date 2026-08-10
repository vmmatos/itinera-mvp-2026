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

import { ItineraryRepairer, REPAIR_MAX_TOKENS } from '@/agents/ItineraryRepairer';
import { AnthropicService } from '@/services/AnthropicService';
import { RabbitMQPublisher } from '@/services/RabbitMQPublisher';
import { RedisService } from '@/services/RedisService';
import { ProposalStorageService } from '@/services/ProposalStorageService';

const VALID_TRIP_ID = '550e8400-e29b-41d4-a716-446655440000';

const ITINERARY = [
  {
    day: 1,
    activities: [{ activity: 'Helicopter tour', venue: 'Heliport', estimatedCostPerPerson: 180 }],
    meals: [{ estimatedCostPerPerson: 50 }],
    transport: [],
  },
];
const ACCOMMODATION = [{ city: 'Barcelona', name: 'Eixample Hotel', pricePerNightPerPerson: 90, nights: 3 }];
const FINANCE_FEEDBACK = {
  overAmountTotal: 200,
  overAmountPerPerson: 100,
  issues: ['Over budget by 200 EUR'],
  suggestedCuts: [{ category: 'activities' as const, description: 'Drop helicopter tour', savingPerPerson: 180, savingTotal: 360 }],
};

const VALID_REPAIR_JSON = JSON.stringify({
  edits: [{ type: 'remove', day: 1, target: 'activity', name: 'Helicopter tour', note: 'most expensive' }],
  summary: 'Dropped helicopter tour',
});

describe('ItineraryRepairer', () => {
  let anthropic: AnthropicService;
  let publisher: RabbitMQPublisher;
  let redis: RedisService;
  let storage: ProposalStorageService;
  let repairer: ItineraryRepairer;

  beforeEach(() => {
    vi.clearAllMocks();
    anthropic = new AnthropicService();
    publisher = new RabbitMQPublisher();
    redis = new RedisService();
    storage = new ProposalStorageService();
    repairer = new ItineraryRepairer(anthropic, publisher, redis, storage);

    vi.mocked(redis.get).mockResolvedValue(null);
    vi.mocked(redis.set).mockResolvedValue(undefined);
    vi.mocked(storage.save).mockResolvedValue(undefined);
    vi.mocked(publisher.publish).mockResolvedValue(undefined);
  });

  function callRepair(): ReturnType<ItineraryRepairer['repair']> {
    return repairer.repair(VALID_TRIP_ID, 2, ITINERARY, ACCOMMODATION, FINANCE_FEEDBACK, 2200, 'EUR', 2, 2420);
  }

  it('happy path: returns the parsed edit list and publishes agent.orchestrator.repair', async () => {
    vi.mocked(anthropic.complete).mockResolvedValue({
      content: VALID_REPAIR_JSON, latencyMs: 400, tokensUsed: 300, truncated: false,
    });

    const event = await callRepair();

    expect(anthropic.complete).toHaveBeenCalledOnce();
    expect(event.content).toMatchObject({ edits: [expect.objectContaining({ name: 'Helicopter tour' })] });
    expect(publisher.publish).toHaveBeenCalledWith('agent.orchestrator.repair', expect.any(Object));
  });

  it('uses the small repair token budget, not the merge one', async () => {
    vi.mocked(anthropic.complete).mockResolvedValue({
      content: VALID_REPAIR_JSON, latencyMs: 400, tokensUsed: 300, truncated: false,
    });

    await callRepair();

    const options = vi.mocked(anthropic.complete).mock.calls[0]![2] as { maxTokens?: number };
    expect(options?.maxTokens).toBe(REPAIR_MAX_TOKENS);
  });

  it('prompt carries the finance feedback and the budget target', async () => {
    vi.mocked(anthropic.complete).mockResolvedValue({
      content: VALID_REPAIR_JSON, latencyMs: 400, tokensUsed: 300, truncated: false,
    });

    await callRepair();

    const messages = vi.mocked(anthropic.complete).mock.calls[0]![1] as Array<{ content: string }>;
    expect(messages[0]!.content).toContain('2420');
    expect(messages[0]!.content).toContain('Drop helicopter tour');
  });

  it('retries once on invalid schema, then succeeds', async () => {
    vi.mocked(anthropic.complete)
      .mockResolvedValueOnce({ content: JSON.stringify({ edits: [] }), latencyMs: 200, tokensUsed: 100, truncated: false })
      .mockResolvedValueOnce({ content: VALID_REPAIR_JSON, latencyMs: 200, tokensUsed: 100, truncated: false });

    const event = await callRepair();

    expect(anthropic.complete).toHaveBeenCalledTimes(2);
    expect(event.content).toMatchObject({ edits: expect.any(Array) });
  });

  it('throws when the edit list is still invalid after the retry (strict mode)', async () => {
    vi.mocked(anthropic.complete).mockResolvedValue({
      content: 'not json at all', latencyMs: 200, tokensUsed: 100, truncated: false,
    });

    await expect(callRepair()).rejects.toThrow(/repair edit list/);
    expect(anthropic.complete).toHaveBeenCalledTimes(2);
  });
});

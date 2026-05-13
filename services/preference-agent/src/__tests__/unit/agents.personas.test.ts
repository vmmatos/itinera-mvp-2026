import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/services/AnthropicService');
vi.mock('@/services/RabbitMQPublisher');
vi.mock('@/services/RedisService');
vi.mock('@/services/ProposalStorageService');

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

import { AliceAgent } from '@/agents/AliceAgent';
import { BobAgent } from '@/agents/BobAgent';
import { CarlosAgent } from '@/agents/CarlosAgent';
import { DianaAgent } from '@/agents/DianaAgent';
import { AnthropicService } from '@/services/AnthropicService';
import { RabbitMQPublisher } from '@/services/RabbitMQPublisher';
import { RedisService } from '@/services/RedisService';
import { ProposalStorageService } from '@/services/ProposalStorageService';

type AnyAgentClass =
  | typeof AliceAgent
  | typeof BobAgent
  | typeof CarlosAgent
  | typeof DianaAgent;

function makeDeps() {
  const anthropic = new AnthropicService();
  const publisher = new RabbitMQPublisher();
  const redis = new RedisService();
  const storage = new ProposalStorageService();
  return { anthropic, publisher, redis, storage };
}

const VALID_JSON_RESPONSE = JSON.stringify({
  proposal: {
    destinations: [{ city: 'Paris', country: 'France', nights: 3 }],
    activities: [
      { day: 1, name: 'Louvre', category: 'museum', description: 'World-class art museum' },
    ],
    reasoning: 'Cultural immersion',
    priorities: ['culture', 'history', 'museums'],
    compromises: 'Open to one leisure day',
  },
});

// ─── Block 1: agentName property ───────────────────────────────────────────

describe.each<[string, AnyAgentClass]>([
  ['alice', AliceAgent],
  ['bob', BobAgent],
  ['carlos', CarlosAgent],
  ['diana', DianaAgent],
])('%s — agentName property', (expectedName, AgentClass) => {
  it(`agentName equals '${expectedName}'`, () => {
    const { anthropic, publisher, redis, storage } = makeDeps();
    const agent = new AgentClass(anthropic, publisher, redis, storage);
    expect(agent.agentName).toBe(expectedName);
  });
});

// ─── Block 2: persona keyword in systemPrompt ──────────────────────────────

describe.each<[string, AnyAgentClass, string]>([
  ['alice', AliceAgent, 'museum'],
  ['bob', BobAgent, 'relaxation'],
  ['carlos', CarlosAgent, 'adventure'],
  ['diana', DianaAgent, 'gastronomy'],
])('%s — systemPrompt contains persona keyword', (_, AgentClass, keyword) => {
  it(`systemPrompt contains '${keyword}'`, () => {
    const { anthropic, publisher, redis, storage } = makeDeps();
    const agent = new AgentClass(anthropic, publisher, redis, storage);
    expect(agent.systemPrompt).toContain(keyword);
  });
});

// ─── Block 3: Alice persona consistency (card #8 explicit requirement) ─────

describe('Alice — persona consistency', () => {
  it("systemPrompt contains 'museum'", () => {
    const { anthropic, publisher, redis, storage } = makeDeps();
    const alice = new AliceAgent(anthropic, publisher, redis, storage);
    expect(alice.systemPrompt).toContain('museum');
  });

  it("systemPrompt contains 'museums' in priorities text", () => {
    const { anthropic, publisher, redis, storage } = makeDeps();
    const alice = new AliceAgent(anthropic, publisher, redis, storage);
    expect(alice.systemPrompt).toContain('museums');
  });

  it("systemPrompt contains 'culture'", () => {
    const { anthropic, publisher, redis, storage } = makeDeps();
    const alice = new AliceAgent(anthropic, publisher, redis, storage);
    expect(alice.systemPrompt).toContain('culture');
  });
});

// ─── Block 4: systemPrompt forwarded to anthropic.complete ─────────────────

describe.each<[string, AnyAgentClass]>([
  ['alice', AliceAgent],
  ['bob', BobAgent],
  ['carlos', CarlosAgent],
  ['diana', DianaAgent],
])('%s — systemPrompt forwarded to anthropic.complete', (_, AgentClass) => {
  let anthropic: AnthropicService;
  let agent: InstanceType<AnyAgentClass>;

  beforeEach(() => {
    vi.clearAllMocks();
    const deps = makeDeps();
    anthropic = deps.anthropic;
    agent = new AgentClass(anthropic, deps.publisher, deps.redis, deps.storage);

    vi.mocked(anthropic.complete).mockResolvedValue({
      content: VALID_JSON_RESPONSE,
      latencyMs: 100,
      tokensUsed: 50,
    });
    vi.mocked(deps.redis.get).mockResolvedValue(null);
    vi.mocked(deps.redis.set).mockResolvedValue(undefined);
    vi.mocked(deps.storage.save).mockResolvedValue(undefined);
    vi.mocked(deps.publisher.publish).mockResolvedValue(undefined);
  });

  it('passes systemPrompt as first arg to anthropic.complete', async () => {
    await agent.propose('trip-001', 1, 'Weekend trip');
    const [firstArg] = vi.mocked(anthropic.complete).mock.calls[0];
    expect(firstArg).toBe(agent.systemPrompt);
  });
});

// ─── Block 5: each agent proposes valid JSON ────────────────────────────────

describe.each<[string, AnyAgentClass]>([
  ['alice', AliceAgent],
  ['bob', BobAgent],
  ['carlos', CarlosAgent],
  ['diana', DianaAgent],
])('%s — propose returns valid parsed JSON', (_, AgentClass) => {
  let agent: InstanceType<AnyAgentClass>;
  let anthropic: AnthropicService;
  let redis: RedisService;
  let storage: ProposalStorageService;
  let publisher: RabbitMQPublisher;

  beforeEach(() => {
    vi.clearAllMocks();
    const deps = makeDeps();
    anthropic = deps.anthropic;
    redis = deps.redis;
    storage = deps.storage;
    publisher = deps.publisher;
    agent = new AgentClass(anthropic, publisher, redis, storage);

    vi.mocked(anthropic.complete).mockResolvedValue({
      content: VALID_JSON_RESPONSE,
      latencyMs: 100,
      tokensUsed: 50,
    });
    vi.mocked(redis.get).mockResolvedValue(null);
    vi.mocked(redis.set).mockResolvedValue(undefined);
    vi.mocked(storage.save).mockResolvedValue(undefined);
    vi.mocked(publisher.publish).mockResolvedValue(undefined);
  });

  it('event.content is a parsed object, not a raw string', async () => {
    const event = await agent.propose('trip-001', 1, 'Trip to Europe');
    expect(typeof event.content).toBe('object');
    expect(event.content).not.toBeNull();
  });

  it('event.content has proposal property', async () => {
    const event = await agent.propose('trip-001', 1, 'Trip to Europe');
    expect(event.content).toHaveProperty('proposal');
  });

  it("event.type is 'agent.propose'", async () => {
    const event = await agent.propose('trip-001', 1, 'Trip to Europe');
    expect(event.type).toBe('agent.propose');
  });

  it('event.agent matches agentName', async () => {
    const event = await agent.propose('trip-001', 1, 'Trip to Europe');
    expect(event.agent).toBe(agent.agentName);
  });
});

// ─── Block 6: all agents have distinct systemPrompts ───────────────────────

it('all four agents have distinct systemPrompts', () => {
  const deps = makeDeps();
  const agents = [
    new AliceAgent(deps.anthropic, deps.publisher, deps.redis, deps.storage),
    new BobAgent(deps.anthropic, deps.publisher, deps.redis, deps.storage),
    new CarlosAgent(deps.anthropic, deps.publisher, deps.redis, deps.storage),
    new DianaAgent(deps.anthropic, deps.publisher, deps.redis, deps.storage),
  ];
  const uniquePrompts = new Set(agents.map((a) => a.systemPrompt));
  expect(uniquePrompts.size).toBe(4);
});

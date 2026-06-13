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
    AI_PROVIDER: 'anthropic',
    NODE_ENV: 'test',
    RABBITMQ_EXCHANGE: 'agent.events',
  },
  getRabbitMQUrl: () => 'amqp://localhost',
  getRedisUrl: () => 'redis://localhost:6379',
}));

import { PreferenceAgent } from '@/agents/PreferenceAgent';
import { PREFERENCE_AGENT_CONFIGS } from '@itinera/shared';
import type { AgentName } from '@itinera/shared';
import { AnthropicService } from '@/services/AnthropicService';
import { RabbitMQPublisher } from '@/services/RabbitMQPublisher';
import { RedisService } from '@/services/RedisService';
import { ProposalStorageService } from '@/services/ProposalStorageService';

function makeDeps() {
  const aiProvider = new AnthropicService();
  const publisher = new RabbitMQPublisher();
  const redis = new RedisService();
  const storage = new ProposalStorageService();
  return { aiProvider, publisher, redis, storage };
}

function makeAgent(name: AgentName) {
  const { aiProvider, publisher, redis, storage } = makeDeps();
  return new PreferenceAgent(name, aiProvider, publisher, redis, storage);
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

describe.each<[AgentName]>([['alice'], ['bob'], ['carlos'], ['diana']])(
  '%s — agentName property',
  (name) => {
    it(`agentName equals '${name}'`, () => {
      const agent = makeAgent(name);
      expect(agent.agentName).toBe(name);
    });
  },
);

// ─── Block 2: persona keyword in systemPrompt ──────────────────────────────

describe.each<[AgentName, string]>([
  ['alice', 'museum'],
  ['bob', 'relaxation'],
  ['carlos', 'adventure'],
  ['diana', 'gastronomy'],
])('%s — systemPrompt contains persona keyword', (name, keyword) => {
  it(`systemPrompt contains '${keyword}'`, () => {
    const agent = makeAgent(name);
    expect(agent.systemPrompt.toLowerCase()).toContain(keyword);
  });
});

// ─── Block 3: Alice persona consistency (card #8 explicit requirement) ─────

describe('Alice — persona consistency', () => {
  it("systemPrompt contains 'museum'", () => {
    expect(makeAgent('alice').systemPrompt.toLowerCase()).toContain('museum');
  });

  it("systemPrompt contains 'museums' in priorities text", () => {
    expect(makeAgent('alice').systemPrompt.toLowerCase()).toContain('museums');
  });

  it("systemPrompt contains 'culture'", () => {
    expect(makeAgent('alice').systemPrompt.toLowerCase()).toContain('culture');
  });
});

// ─── Block 4: systemPrompt forwarded to aiProvider.complete ────────────────

describe.each<[AgentName]>([['alice'], ['bob'], ['carlos'], ['diana']])(
  '%s — systemPrompt forwarded to aiProvider.complete',
  (name) => {
    let deps: ReturnType<typeof makeDeps>;
    let agent: PreferenceAgent;

    beforeEach(() => {
      vi.clearAllMocks();
      deps = makeDeps();
      agent = new PreferenceAgent(name, deps.aiProvider, deps.publisher, deps.redis, deps.storage);

      vi.mocked(deps.aiProvider.complete).mockResolvedValue({
        content: VALID_JSON_RESPONSE,
        latencyMs: 100,
        tokensUsed: 50,
      });
      vi.mocked(deps.redis.get).mockResolvedValue(null);
      vi.mocked(deps.redis.set).mockResolvedValue(undefined);
      vi.mocked(deps.storage.save).mockResolvedValue(undefined);
      vi.mocked(deps.publisher.publish).mockResolvedValue(undefined);
    });

    it('passes systemPrompt as first arg to aiProvider.complete', async () => {
      await agent.propose('trip-001', 1, 'Weekend trip');
      const [firstArg] = vi.mocked(deps.aiProvider.complete).mock.calls[0];
      expect(firstArg).toBe(agent.systemPrompt);
    });
  },
);

// ─── Block 5: each agent proposes valid JSON ────────────────────────────────

describe.each<[AgentName]>([['alice'], ['bob'], ['carlos'], ['diana']])(
  '%s — propose returns valid parsed JSON',
  (name) => {
    let deps: ReturnType<typeof makeDeps>;
    let agent: PreferenceAgent;

    beforeEach(() => {
      vi.clearAllMocks();
      deps = makeDeps();
      agent = new PreferenceAgent(name, deps.aiProvider, deps.publisher, deps.redis, deps.storage);

      vi.mocked(deps.aiProvider.complete).mockResolvedValue({
        content: VALID_JSON_RESPONSE,
        latencyMs: 100,
        tokensUsed: 50,
      });
      vi.mocked(deps.redis.get).mockResolvedValue(null);
      vi.mocked(deps.redis.set).mockResolvedValue(undefined);
      vi.mocked(deps.storage.save).mockResolvedValue(undefined);
      vi.mocked(deps.publisher.publish).mockResolvedValue(undefined);
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
  },
);

// ─── Block 6: all agents have distinct systemPrompts ───────────────────────

it('all four agents have distinct systemPrompts', () => {
  const agents = PREFERENCE_AGENT_CONFIGS.map((cfg) => makeAgent(cfg.name));
  const uniquePrompts = new Set(agents.map((a) => a.systemPrompt));
  expect(uniquePrompts.size).toBe(4);
});

// ─── Block 7: PREFERENCE_AGENT_CONFIGS covers all 4 agents ─────────────────

it('PREFERENCE_AGENT_CONFIGS has exactly 4 entries: alice, bob, carlos, diana', () => {
  const names = PREFERENCE_AGENT_CONFIGS.map((c) => c.name);
  expect(names).toEqual(expect.arrayContaining(['alice', 'bob', 'carlos', 'diana']));
  expect(names).toHaveLength(4);
});

it('each PREFERENCE_AGENT_CONFIGS entry has name, persona, and preferences array', () => {
  for (const cfg of PREFERENCE_AGENT_CONFIGS) {
    expect(typeof cfg.name).toBe('string');
    expect(typeof cfg.persona).toBe('string');
    expect(Array.isArray(cfg.preferences)).toBe(true);
    expect(cfg.preferences.length).toBeGreaterThan(0);
  }
});

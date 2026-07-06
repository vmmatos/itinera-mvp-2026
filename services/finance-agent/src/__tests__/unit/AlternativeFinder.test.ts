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

import { AlternativeFinder } from '@/agents/AlternativeFinder';
import { AnthropicService } from '@/services/AnthropicService';
import { RabbitMQPublisher } from '@/services/RabbitMQPublisher';
import { RedisService } from '@/services/RedisService';
import { ProposalStorageService } from '@/services/ProposalStorageService';
import type { CostBreakdown } from '@/agents/CostCalculator';
import type { BudgetValidation } from '@/agents/BudgetValidator';

const VALID_TRIP_ID = '550e8400-e29b-41d4-a716-446655440000';

const MOCK_BREAKDOWN: CostBreakdown = {
  byCategory: { accommodation: 0, activities: 500, meals: 300, transport: 200 },
  perPersonTotal: 1000,
  grandTotal: 1000,
  groupSize: 1,
  currency: 'EUR',
  items: [],
};

const WITHIN_BUDGET_VALIDATION: BudgetValidation = {
  status: 'within_budget',
  percentageUsed: 80,
  remaining: 250,
  budgetTotal: 1250,
  currency: 'EUR',
};

const OVER_BUDGET_VALIDATION: BudgetValidation = {
  status: 'over_budget',
  percentageUsed: 120,
  remaining: -200,
  overAmount: 200,
  budgetTotal: 800,
  currency: 'EUR',
};

const MOCK_PROPOSAL = { itinerary: [{ day: 1, activities: [], meals: [], transport: [] }] };

const MOCK_ALTERNATIVES_JSON = JSON.stringify({
  suggestions: [
    {
      category: 'activities',
      originalItem: { name: 'Louvre', cost: 20 },
      suggestion: { name: 'Free walking tour', estimatedCost: 0, saving: 20 },
      rationale: 'Self-guided tours are free',
    },
  ],
  totalPotentialSaving: 20,
  revisedBudgetEstimate: 780,
  negotiationSummary: 'Minor adjustments can bring this within budget.',
});

describe('AlternativeFinder', () => {
  let anthropic: AnthropicService;
  let publisher: RabbitMQPublisher;
  let redis: RedisService;
  let storage: ProposalStorageService;
  let finder: AlternativeFinder;

  beforeEach(() => {
    vi.clearAllMocks();
    anthropic = new AnthropicService();
    publisher = new RabbitMQPublisher();
    redis = new RedisService();
    storage = new ProposalStorageService();
    finder = new AlternativeFinder(anthropic, publisher, redis, storage);

    vi.mocked(anthropic.complete).mockResolvedValue({
      content: MOCK_ALTERNATIVES_JSON,
      latencyMs: 400,
      tokensUsed: 300,
    });
    vi.mocked(storage.save).mockResolvedValue(undefined);
    vi.mocked(publisher.publish).mockResolvedValue(undefined);
  });

  describe('within_budget', () => {
    it('does not call Claude when within budget', async () => {
      await finder.findAlternatives(VALID_TRIP_ID, 1, MOCK_PROPOSAL, MOCK_BREAKDOWN, WITHIN_BUDGET_VALIDATION, '');
      expect(anthropic.complete).not.toHaveBeenCalled();
    });

    it('does not store event (orchestrator owns persistence)', async () => {
      await finder.findAlternatives(VALID_TRIP_ID, 1, MOCK_PROPOSAL, MOCK_BREAKDOWN, WITHIN_BUDGET_VALIDATION, '');
      expect(storage.save).not.toHaveBeenCalled();
    });

    it('publishes event when within budget', async () => {
      await finder.findAlternatives(VALID_TRIP_ID, 1, MOCK_PROPOSAL, MOCK_BREAKDOWN, WITHIN_BUDGET_VALIDATION, '');
      expect(publisher.publish).toHaveBeenCalledOnce();
    });

    it('publishes with routing key agent.finance.propose', async () => {
      await finder.findAlternatives(VALID_TRIP_ID, 1, MOCK_PROPOSAL, MOCK_BREAKDOWN, WITHIN_BUDGET_VALIDATION, '');
      expect(publisher.publish).toHaveBeenCalledWith('agent.finance.propose', expect.any(Object));
    });

    it('event content includes costBreakdown and budgetValidation', async () => {
      const event = await finder.findAlternatives(VALID_TRIP_ID, 1, MOCK_PROPOSAL, MOCK_BREAKDOWN, WITHIN_BUDGET_VALIDATION, '');
      const content = event.content as Record<string, unknown>;
      expect(content.costBreakdown).toBeDefined();
      expect(content.budgetValidation).toBeDefined();
      expect(content.alternatives).toBeUndefined();
    });

    it('event has no metrics when within budget (no Claude call)', async () => {
      const event = await finder.findAlternatives(VALID_TRIP_ID, 1, MOCK_PROPOSAL, MOCK_BREAKDOWN, WITHIN_BUDGET_VALIDATION, '');
      expect(event.metrics).toBeUndefined();
    });
  });

  describe('over_budget', () => {
    it('calls Claude when over budget', async () => {
      await finder.findAlternatives(VALID_TRIP_ID, 1, MOCK_PROPOSAL, MOCK_BREAKDOWN, OVER_BUDGET_VALIDATION, '');
      expect(anthropic.complete).toHaveBeenCalledOnce();
    });

    it('publishes with routing key agent.finance.propose when over budget', async () => {
      await finder.findAlternatives(VALID_TRIP_ID, 1, MOCK_PROPOSAL, MOCK_BREAKDOWN, OVER_BUDGET_VALIDATION, '');
      expect(publisher.publish).toHaveBeenCalledWith('agent.finance.propose', expect.any(Object));
    });

    it('event content includes costBreakdown, budgetValidation, and alternatives', async () => {
      const event = await finder.findAlternatives(VALID_TRIP_ID, 1, MOCK_PROPOSAL, MOCK_BREAKDOWN, OVER_BUDGET_VALIDATION, '');
      const content = event.content as Record<string, unknown>;
      expect(content.costBreakdown).toBeDefined();
      expect(content.budgetValidation).toBeDefined();
      expect(content.alternatives).toBeDefined();
    });

    it('event has latencyMs and tokensUsed when over budget', async () => {
      const event = await finder.findAlternatives(VALID_TRIP_ID, 1, MOCK_PROPOSAL, MOCK_BREAKDOWN, OVER_BUDGET_VALIDATION, '');
      expect(event.metrics?.latencyMs).toBe(400);
      expect(event.metrics?.tokensUsed).toBe(300);
    });

    it('includes budget info and itinerary in Claude prompt', async () => {
      await finder.findAlternatives(VALID_TRIP_ID, 1, MOCK_PROPOSAL, MOCK_BREAKDOWN, OVER_BUDGET_VALIDATION, 'Paris trip');
      const callArg = vi.mocked(anthropic.complete).mock.calls[0];
      const callStr = JSON.stringify(callArg);
      expect(callStr).toContain('Paris trip');
      expect(callStr).toContain('800');
      expect(callStr).toContain('200');
    });

    it('handles non-JSON Claude response gracefully', async () => {
      vi.mocked(anthropic.complete).mockResolvedValue({
        content: 'here are some alternatives',
        latencyMs: 200,
        tokensUsed: 40,
      });

      const event = await finder.findAlternatives(VALID_TRIP_ID, 1, MOCK_PROPOSAL, MOCK_BREAKDOWN, OVER_BUDGET_VALIDATION, '');
      const content = event.content as Record<string, unknown>;
      expect(content.alternatives).toEqual({ raw: 'here are some alternatives' });
    });

    it('event agent is finance', async () => {
      const event = await finder.findAlternatives(VALID_TRIP_ID, 1, MOCK_PROPOSAL, MOCK_BREAKDOWN, OVER_BUDGET_VALIDATION, '');
      expect(event.agent).toBe('finance');
    });

    it('event round and tripId are correct', async () => {
      const event = await finder.findAlternatives(VALID_TRIP_ID, 3, MOCK_PROPOSAL, MOCK_BREAKDOWN, OVER_BUDGET_VALIDATION, '');
      expect(event.round).toBe(3);
      expect(event.tripId).toBe(VALID_TRIP_ID);
    });
  });

  // ── Flexible dates pricing note ───────────────────────────────

  describe('flexible dateInput', () => {
    const FLEXIBLE_DATE_INPUT = {
      mode: 'flexible' as const,
      days: 7,
      preferredMonth: '2026-07',
      window: 'moderate' as const,
    };

    it('over_budget + flexible: includes PRICING NOTE in Claude prompt', async () => {
      await finder.findAlternatives(
        VALID_TRIP_ID, 1, MOCK_PROPOSAL, MOCK_BREAKDOWN, OVER_BUDGET_VALIDATION, '', FLEXIBLE_DATE_INPUT,
      );

      const callArg = vi.mocked(anthropic.complete).mock.calls[0];
      const callStr = JSON.stringify(callArg);
      expect(callStr).toContain('PRICING NOTE');
      expect(callStr).toContain('2026-07');
      expect(callStr).toContain('weekday vs weekend');
    });

    it('within_budget + flexible: Claude still not called (fast path unchanged)', async () => {
      await finder.findAlternatives(
        VALID_TRIP_ID, 1, MOCK_PROPOSAL, MOCK_BREAKDOWN, WITHIN_BUDGET_VALIDATION, '', FLEXIBLE_DATE_INPUT,
      );

      expect(anthropic.complete).not.toHaveBeenCalled();
    });

    it('over_budget + fixed dateInput: no PRICING NOTE in prompt', async () => {
      const fixedDateInput = { mode: 'fixed' as const, startDate: '2026-07-01', endDate: '2026-07-08' };

      await finder.findAlternatives(
        VALID_TRIP_ID, 1, MOCK_PROPOSAL, MOCK_BREAKDOWN, OVER_BUDGET_VALIDATION, '', fixedDateInput,
      );

      const callArg = vi.mocked(anthropic.complete).mock.calls[0];
      const callStr = JSON.stringify(callArg);
      expect(callStr).not.toContain('PRICING NOTE');
    });
  });
});

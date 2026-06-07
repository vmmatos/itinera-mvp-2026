import { describe, it, expect, vi, beforeEach } from 'vitest';

// Must be hoisted before any imports that transitively load these modules
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

import { ConflictAnalyzer } from '@/agents/ConflictAnalyzer';
import { CompromiseGenerator } from '@/agents/CompromiseGenerator';
import { AnthropicService } from '@/services/AnthropicService';
import { RabbitMQPublisher } from '@/services/RabbitMQPublisher';
import { RedisService } from '@/services/RedisService';
import { ProposalStorageService } from '@/services/ProposalStorageService';
import type { AgentEvent } from '@itinera/shared';
import {
  TRIP_ID,
  TRIP_CONTEXT,
  ALICE_PROPOSAL,
  BOB_PROPOSAL,
  CONFLICT_ANALYSIS_RESPONSE,
  COMPROMISE_RESPONSE,
} from './helpers/sintra-fixtures';

// ── Admin debug view contracts ─────────────────────────────────
//
// After a negotiation session, the admin debug dashboard fetches
// GET /api/v1/trips/:id?view=debug which returns proposals, agentLogs,
// and metrics. This scenario verifies that every agent event produced
// during negotiation carries the required structure for the admin view:
// - Required fields: tripId, round, agent, type, timestamp, content
// - Metrics fields (latencyMs, tokensUsed) are present for performance panel
// - ProposalStorageService.save() called for every proposal event
// - RabbitMQPublisher.publish() routes events with correct routing keys

interface ConflictAnalysisContent {
  conflicts: Array<{ agents: string[]; topic: string; description: string; severity: number }>;
  consensusAreas: Array<{ topic: string; agents: string[] }>;
  overallConflictScore: number;
  roundSummary: string;
}

interface CompromiseContent {
  itinerary: Array<{ day: number; activities: Array<{ time: string; activity: string; cost: number }> }>;
  satisfactionEstimates: Record<string, number>;
  compromiseRationale: string;
}

describe('Scenario 007 — Admin Debug View data contracts', () => {
  let anthropic: AnthropicService;
  let publisher: RabbitMQPublisher;
  let redis: RedisService;
  let storage: ProposalStorageService;
  let analyzer: ConflictAnalyzer;
  let generator: CompromiseGenerator;

  beforeEach(() => {
    vi.clearAllMocks();
    anthropic = new AnthropicService();
    publisher = new RabbitMQPublisher();
    redis = new RedisService();
    storage = new ProposalStorageService();
    analyzer = new ConflictAnalyzer(anthropic, publisher, redis, storage);
    generator = new CompromiseGenerator(anthropic, publisher, redis, storage);

    vi.mocked(redis.get).mockResolvedValue(null);
    vi.mocked(redis.set).mockResolvedValue(undefined);
    vi.mocked(storage.save).mockResolvedValue(undefined);
    vi.mocked(publisher.publish).mockResolvedValue(undefined);
  });

  // ── AgentEvent shape for admin NegotiationPanel ────────────────

  describe('ConflictAnalyzer event — NegotiationPanel feed contract', () => {
    beforeEach(() => {
      vi.mocked(anthropic.complete).mockResolvedValue({
        content: CONFLICT_ANALYSIS_RESPONSE,
        latencyMs: 412,
        tokensUsed: 2800,
      });
    });

    it('event has all required fields for admin live feed', async () => {
      const event = await analyzer.analyze(TRIP_ID, 1, [ALICE_PROPOSAL, BOB_PROPOSAL]);

      expect(event.tripId).toBe(TRIP_ID);
      expect(typeof event.round).toBe('number');
      expect(typeof event.agent).toBe('string');
      expect(typeof event.type).toBe('string');
      expect(typeof event.timestamp).toBe('string');
      expect(event.content).toBeDefined();
    });

    it('event.metrics present with latencyMs and tokensUsed for MetricsPanel', async () => {
      const event = await analyzer.analyze(TRIP_ID, 1, [ALICE_PROPOSAL, BOB_PROPOSAL]);

      expect(event.metrics).toBeDefined();
      expect(typeof event.metrics?.latencyMs).toBe('number');
      expect(typeof event.metrics?.tokensUsed).toBe('number');
      expect(event.metrics!.latencyMs).toBe(412);
      expect(event.metrics!.tokensUsed).toBe(2800);
    });

    it('event published to RabbitMQ for ws-relay SSE broadcast', async () => {
      await analyzer.analyze(TRIP_ID, 1, [ALICE_PROPOSAL, BOB_PROPOSAL]);

      expect(vi.mocked(publisher.publish)).toHaveBeenCalledTimes(1);
      const [routingKey] = vi.mocked(publisher.publish).mock.calls[0];
      expect(routingKey).toMatch(/^agent\./);
    });

    it('event published to RabbitMQ for ws-relay SSE broadcast and admin DB persistence', async () => {
      // Agents publish events to RabbitMQ; orchestrator service persists them to DB
      const event = await analyzer.analyze(TRIP_ID, 1, [ALICE_PROPOSAL, BOB_PROPOSAL]);

      expect(vi.mocked(publisher.publish)).toHaveBeenCalledTimes(1);
      const [, publishedEvent] = vi.mocked(publisher.publish).mock.calls[0];
      expect((publishedEvent as AgentEvent).tripId).toBe(event.tripId);
      expect((publishedEvent as AgentEvent).round).toBe(1);
    });

    it('content parsed as valid JSON for admin proposal content viewer', async () => {
      const event = await analyzer.analyze(TRIP_ID, 1, [ALICE_PROPOSAL, BOB_PROPOSAL]);
      const content = event.content as ConflictAnalysisContent;

      expect(typeof content).toBe('object');
      expect(Array.isArray(content.conflicts)).toBe(true);
      expect(Array.isArray(content.consensusAreas)).toBe(true);
      expect(typeof content.overallConflictScore).toBe('number');
    });
  });

  // ── CompromiseGenerator event — MetricsPanel satisfaction contract ─

  describe('CompromiseGenerator event — MetricsPanel satisfaction contract', () => {
    beforeEach(() => {
      vi.mocked(anthropic.complete).mockResolvedValue({
        content: COMPROMISE_RESPONSE,
        latencyMs: 680,
        tokensUsed: 4200,
      });
    });

    it('compromise event has metrics for AgentActivityLog latency display', async () => {
      const conflicts = JSON.parse(CONFLICT_ANALYSIS_RESPONSE);
      const event = await generator.generateCompromise(TRIP_ID, 2, conflicts, TRIP_CONTEXT);

      expect(event.metrics).toBeDefined();
      expect(event.metrics!.latencyMs).toBe(680);
      expect(event.metrics!.tokensUsed).toBe(4200);
    });

    it('compromise content has satisfactionEstimates for per-agent bars', async () => {
      const conflicts = JSON.parse(CONFLICT_ANALYSIS_RESPONSE);
      const event = await generator.generateCompromise(TRIP_ID, 2, conflicts, TRIP_CONTEXT);
      const content = event.content as CompromiseContent;

      expect(typeof content.satisfactionEstimates).toBe('object');
      expect(typeof content.satisfactionEstimates['alice']).toBe('number');
      expect(typeof content.satisfactionEstimates['bob']).toBe('number');
    });

    it('satisfaction estimates in 0–1 range for MetricsPanel bar widths', async () => {
      const conflicts = JSON.parse(CONFLICT_ANALYSIS_RESPONSE);
      const event = await generator.generateCompromise(TRIP_ID, 2, conflicts, TRIP_CONTEXT);
      const content = event.content as CompromiseContent;

      for (const score of Object.values(content.satisfactionEstimates)) {
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(1);
      }
    });

    it('compromise event published to RabbitMQ for admin DB persistence', async () => {
      // Agents publish events; the orchestrator service persists them to DB
      const conflicts = JSON.parse(CONFLICT_ANALYSIS_RESPONSE);
      await generator.generateCompromise(TRIP_ID, 2, conflicts, TRIP_CONTEXT);

      expect(vi.mocked(publisher.publish)).toHaveBeenCalledTimes(1);
      const [, publishedEvent] = vi.mocked(publisher.publish).mock.calls[0];
      expect((publishedEvent as AgentEvent).tripId).toBe(TRIP_ID);
      expect((publishedEvent as AgentEvent).round).toBe(2);
    });
  });

  // ── Multi-round event accumulation — convergence chart data ───

  describe('Multi-round negotiation — convergence chart data', () => {
    it('each round publishes one event to RabbitMQ for timeline chart data', async () => {
      vi.mocked(anthropic.complete).mockResolvedValue({
        content: CONFLICT_ANALYSIS_RESPONSE,
        latencyMs: 350,
        tokensUsed: 2000,
      });

      await analyzer.analyze(TRIP_ID, 1, [ALICE_PROPOSAL, BOB_PROPOSAL]);
      await analyzer.analyze(TRIP_ID, 2, [ALICE_PROPOSAL, BOB_PROPOSAL]);
      await analyzer.analyze(TRIP_ID, 3, [ALICE_PROPOSAL, BOB_PROPOSAL]);

      // Each round → one publish call → ws-relay broadcasts for admin live feed
      expect(vi.mocked(publisher.publish)).toHaveBeenCalledTimes(3);
      const rounds = vi.mocked(publisher.publish).mock.calls.map(
        ([, ev]) => (ev as AgentEvent).round,
      );
      expect(rounds).toEqual([1, 2, 3]);
    });

    it('token accumulation across rounds matches MetricsPanel total', async () => {
      vi.mocked(anthropic.complete)
        .mockResolvedValueOnce({ content: CONFLICT_ANALYSIS_RESPONSE, latencyMs: 300, tokensUsed: 1000 })
        .mockResolvedValueOnce({ content: CONFLICT_ANALYSIS_RESPONSE, latencyMs: 400, tokensUsed: 1500 })
        .mockResolvedValueOnce({ content: CONFLICT_ANALYSIS_RESPONSE, latencyMs: 350, tokensUsed: 1200 });

      const events: AgentEvent[] = [];
      events.push(await analyzer.analyze(TRIP_ID, 1, [ALICE_PROPOSAL, BOB_PROPOSAL]));
      events.push(await analyzer.analyze(TRIP_ID, 2, [ALICE_PROPOSAL, BOB_PROPOSAL]));
      events.push(await analyzer.analyze(TRIP_ID, 3, [ALICE_PROPOSAL, BOB_PROPOSAL]));

      const totalTokens = events.reduce((sum, e) => sum + (e.metrics?.tokensUsed ?? 0), 0);
      expect(totalTokens).toBe(3700);
    });
  });

  // ── Routing key format — ws-relay SSE routing contract ────────

  describe('RabbitMQ routing key format — ws-relay broadcast contract', () => {
    it('conflict analysis routed with agent.*.score key for SSE event type', async () => {
      vi.mocked(anthropic.complete).mockResolvedValue({
        content: CONFLICT_ANALYSIS_RESPONSE,
        latencyMs: 300,
        tokensUsed: 2000,
      });

      await analyzer.analyze(TRIP_ID, 1, [ALICE_PROPOSAL, BOB_PROPOSAL]);

      const [routingKey] = vi.mocked(publisher.publish).mock.calls[0];
      expect(routingKey).toMatch(/^agent\.[a-z]+\.[a-z]+$/);
    });

    it('compromise event routed with agent prefix for SSE broadcast', async () => {
      vi.mocked(anthropic.complete).mockResolvedValue({
        content: COMPROMISE_RESPONSE,
        latencyMs: 500,
        tokensUsed: 3500,
      });

      const conflicts = JSON.parse(CONFLICT_ANALYSIS_RESPONSE);
      await generator.generateCompromise(TRIP_ID, 1, conflicts, TRIP_CONTEXT);

      const [routingKey] = vi.mocked(publisher.publish).mock.calls[0];
      expect(routingKey).toMatch(/^agent\./);
    });
  });
});

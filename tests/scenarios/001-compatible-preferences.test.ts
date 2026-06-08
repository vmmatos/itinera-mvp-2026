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
  NON_JSON_RESPONSE,
  HIGH_CONFLICT_ANALYSIS_RESPONSE,
} from './helpers/sintra-fixtures';

interface ConflictAnalysisContent {
  conflicts: Array<{ agents: string[]; topic: string; description: string; severity: number }>;
  consensusAreas: Array<{ topic: string; agents: string[] }>;
  overallConflictScore: number;
  roundSummary: string;
}

interface SintraActivity {
  time: string;
  activity: string;
  cost: number;
  currency: string;
  satisfies: string[];
  description: string;
}

interface CompromiseContent {
  itinerary: Array<{ day: number; activities: SintraActivity[] }>;
  satisfactionEstimates: Record<string, number>;
  unresolvedConflicts: unknown[];
  compromiseRationale: string;
}

describe('Scenario 001 — Alice+Bob, Sintra, 2 days, €300 budget', () => {
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

  // -------------------------------------------------------------------------
  describe('ConflictAnalyzer — compatible Alice+Bob preferences', () => {
    beforeEach(() => {
      vi.mocked(anthropic.complete).mockResolvedValue({
        content: CONFLICT_ANALYSIS_RESPONSE,
        latencyMs: 350,
        tokensUsed: 220,
      });
    });

    it('returns overallConflictScore ≤ 1 for compatible Sintra proposals', async () => {
      const event = await analyzer.analyze(TRIP_ID, 1, [ALICE_PROPOSAL, BOB_PROPOSAL]);
      const content = event.content as ConflictAnalysisContent;

      expect(content.overallConflictScore).toBeLessThanOrEqual(1);
    });

    it('consensusAreas includes location and cultural_heritage for both agents', async () => {
      const event = await analyzer.analyze(TRIP_ID, 1, [ALICE_PROPOSAL, BOB_PROPOSAL]);
      const content = event.content as ConflictAnalysisContent;

      const topics = content.consensusAreas.map((a) => a.topic);
      expect(topics).toContain('location');
      expect(topics).toContain('cultural_heritage');

      const locationArea = content.consensusAreas.find((a) => a.topic === 'location');
      expect(locationArea?.agents).toContain('alice');
      expect(locationArea?.agents).toContain('bob');
    });

    it('produces a valid AgentEvent with required fields', async () => {
      const event = await analyzer.analyze(TRIP_ID, 1, [ALICE_PROPOSAL, BOB_PROPOSAL]);

      expect(event.tripId).toBe(TRIP_ID);
      expect(event.round).toBe(1);
      expect(event.type).toBe('agent.score');
      expect(event.agent).toBe('orchestrator');
      expect(event.timestamp).toBeDefined();
      expect(event.metrics?.latencyMs).toBe(350);
      expect(event.metrics?.tokensUsed).toBe(220);
    });

    it('publishes to routing key agent.orchestrator.score', async () => {
      await analyzer.analyze(TRIP_ID, 1, [ALICE_PROPOSAL, BOB_PROPOSAL]);

      expect(publisher.publish).toHaveBeenCalledWith(
        'agent.orchestrator.score',
        expect.any(Object),
      );
    });

    it('publishes event to RabbitMQ on cache miss', async () => {
      // Agents publish events; the orchestrator service persists them to DB
      await analyzer.analyze(TRIP_ID, 1, [ALICE_PROPOSAL, BOB_PROPOSAL]);

      expect(publisher.publish).toHaveBeenCalledOnce();
    });

    it('cache hit returns cached event without calling Claude', async () => {
      const cachedEvent: AgentEvent = {
        tripId: TRIP_ID,
        type: 'agent.score',
        agent: 'orchestrator',
        round: 1,
        timestamp: new Date().toISOString(),
        content: JSON.parse(CONFLICT_ANALYSIS_RESPONSE),
      };
      vi.mocked(redis.get).mockResolvedValue(cachedEvent);

      const event = await analyzer.analyze(TRIP_ID, 1, [ALICE_PROPOSAL, BOB_PROPOSAL]);

      expect(anthropic.complete).not.toHaveBeenCalled();
      expect(storage.save).not.toHaveBeenCalled();
      expect(publisher.publish).not.toHaveBeenCalled();
      expect(event).toEqual(cachedEvent);
    });

    it('includes both agent proposals in the Claude prompt', async () => {
      await analyzer.analyze(TRIP_ID, 1, [ALICE_PROPOSAL, BOB_PROPOSAL]);

      const callArgs = vi.mocked(anthropic.complete).mock.calls[0];
      const promptText = JSON.stringify(callArgs);
      expect(promptText).toContain('alice');
      expect(promptText).toContain('bob');
    });

    it('conflicts array is empty for compatible preferences', async () => {
      const event = await analyzer.analyze(TRIP_ID, 1, [ALICE_PROPOSAL, BOB_PROPOSAL]);
      const content = event.content as ConflictAnalysisContent;

      expect(content.conflicts).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  describe('CompromiseGenerator — Sintra compromise satisfies both agents', () => {
    beforeEach(() => {
      vi.mocked(anthropic.complete).mockResolvedValue({
        content: COMPROMISE_RESPONSE,
        latencyMs: 480,
        tokensUsed: 310,
      });
    });

    it('satisfactionEstimates.alice ≥ 0.80', async () => {
      const conflictAnalysis = JSON.parse(CONFLICT_ANALYSIS_RESPONSE);
      const event = await generator.generateCompromise(TRIP_ID, 1, conflictAnalysis, TRIP_CONTEXT);
      const content = event.content as CompromiseContent;

      expect(content.satisfactionEstimates['alice']).toBeGreaterThanOrEqual(0.8);
    });

    it('satisfactionEstimates.bob ≥ 0.80', async () => {
      const conflictAnalysis = JSON.parse(CONFLICT_ANALYSIS_RESPONSE);
      const event = await generator.generateCompromise(TRIP_ID, 1, conflictAnalysis, TRIP_CONTEXT);
      const content = event.content as CompromiseContent;

      expect(content.satisfactionEstimates['bob']).toBeGreaterThanOrEqual(0.8);
    });

    it('unresolvedConflicts is empty — full convergence', async () => {
      const conflictAnalysis = JSON.parse(CONFLICT_ANALYSIS_RESPONSE);
      const event = await generator.generateCompromise(TRIP_ID, 1, conflictAnalysis, TRIP_CONTEXT);
      const content = event.content as CompromiseContent;

      expect(content.unresolvedConflicts).toHaveLength(0);
    });

    it('itinerary covers both day 1 and day 2', async () => {
      const conflictAnalysis = JSON.parse(CONFLICT_ANALYSIS_RESPONSE);
      const event = await generator.generateCompromise(TRIP_ID, 1, conflictAnalysis, TRIP_CONTEXT);
      const content = event.content as CompromiseContent;

      const days = content.itinerary.map((d) => d.day);
      expect(days).toContain(1);
      expect(days).toContain(2);
    });

    it('produces a valid AgentEvent with required fields', async () => {
      const conflictAnalysis = JSON.parse(CONFLICT_ANALYSIS_RESPONSE);
      const event = await generator.generateCompromise(TRIP_ID, 1, conflictAnalysis, TRIP_CONTEXT);

      expect(event.tripId).toBe(TRIP_ID);
      expect(event.round).toBe(1);
      expect(event.type).toBe('agent.propose');
      expect(event.agent).toBe('orchestrator');
      expect(event.timestamp).toBeDefined();
      expect(event.metrics?.latencyMs).toBe(480);
      expect(event.metrics?.tokensUsed).toBe(310);
    });

    it('publishes to routing key agent.orchestrator.propose', async () => {
      const conflictAnalysis = JSON.parse(CONFLICT_ANALYSIS_RESPONSE);
      await generator.generateCompromise(TRIP_ID, 1, conflictAnalysis, TRIP_CONTEXT);

      expect(publisher.publish).toHaveBeenCalledWith(
        'agent.orchestrator.propose',
        expect.any(Object),
      );
    });

    it('publishes compromise event to RabbitMQ', async () => {
      // Agents publish events; the orchestrator service persists them to DB
      const conflictAnalysis = JSON.parse(CONFLICT_ANALYSIS_RESPONSE);
      await generator.generateCompromise(TRIP_ID, 1, conflictAnalysis, TRIP_CONTEXT);

      expect(publisher.publish).toHaveBeenCalledOnce();
    });

    it('conflict analysis context is included in Claude prompt', async () => {
      const conflictAnalysis = JSON.parse(CONFLICT_ANALYSIS_RESPONSE);
      await generator.generateCompromise(TRIP_ID, 1, conflictAnalysis, TRIP_CONTEXT);

      const callArgs = vi.mocked(anthropic.complete).mock.calls[0];
      const promptText = JSON.stringify(callArgs);
      expect(promptText).toContain('Sintra');
    });
  });

  // -------------------------------------------------------------------------
  describe('End-to-end negotiation flow', () => {
    it('converges within 4 rounds for compatible preferences', async () => {
      // Round 1: low conflict → converge immediately
      vi.mocked(anthropic.complete)
        .mockResolvedValueOnce({
          content: CONFLICT_ANALYSIS_RESPONSE, // overallConflictScore: 0.5
          latencyMs: 350,
          tokensUsed: 220,
        })
        .mockResolvedValueOnce({
          content: COMPROMISE_RESPONSE,
          latencyMs: 480,
          tokensUsed: 310,
        });

      const MAX_ROUNDS = 4;
      let roundsCompleted = 0;
      let compromise: AgentEvent | null = null;

      for (let round = 1; round <= MAX_ROUNDS; round++) {
        const analysis = await analyzer.analyze(TRIP_ID, round, [ALICE_PROPOSAL, BOB_PROPOSAL]);
        const content = analysis.content as ConflictAnalysisContent;
        roundsCompleted = round;

        if (content.overallConflictScore < 1.0) {
          compromise = await generator.generateCompromise(
            TRIP_ID,
            round,
            analysis.content,
            TRIP_CONTEXT,
          );
          break;
        }
      }

      expect(compromise).not.toBeNull();
      expect(roundsCompleted).toBeLessThanOrEqual(MAX_ROUNDS);
    });

    it('final compromise budget ≤ €300 for 2 people', async () => {
      vi.mocked(anthropic.complete)
        .mockResolvedValueOnce({ content: CONFLICT_ANALYSIS_RESPONSE, latencyMs: 300, tokensUsed: 200 })
        .mockResolvedValueOnce({ content: COMPROMISE_RESPONSE, latencyMs: 400, tokensUsed: 280 });

      const analysis = await analyzer.analyze(TRIP_ID, 1, [ALICE_PROPOSAL, BOB_PROPOSAL]);
      const compromise = await generator.generateCompromise(TRIP_ID, 1, analysis.content, TRIP_CONTEXT);
      const content = compromise.content as CompromiseContent;

      const totalPerPerson = content.itinerary
        .flatMap((day) => day.activities)
        .reduce((sum, act) => sum + act.cost, 0);

      const totalForTwoPeople = totalPerPerson * 2;
      expect(totalForTwoPeople).toBeLessThanOrEqual(300);
    });

    it('no logistical conflicts — activity times do not overlap within a day', async () => {
      vi.mocked(anthropic.complete)
        .mockResolvedValueOnce({ content: CONFLICT_ANALYSIS_RESPONSE, latencyMs: 300, tokensUsed: 200 })
        .mockResolvedValueOnce({ content: COMPROMISE_RESPONSE, latencyMs: 400, tokensUsed: 280 });

      const analysis = await analyzer.analyze(TRIP_ID, 1, [ALICE_PROPOSAL, BOB_PROPOSAL]);
      const compromise = await generator.generateCompromise(TRIP_ID, 1, analysis.content, TRIP_CONTEXT);
      const content = compromise.content as CompromiseContent;

      for (const day of content.itinerary) {
        const startMinutes = day.activities.map((act) => {
          const [h, m] = act.time.split(':').map(Number);
          return h * 60 + m;
        });

        // Each activity starts strictly after the previous one
        for (let i = 1; i < startMinutes.length; i++) {
          expect(startMinutes[i]).toBeGreaterThan(startMinutes[i - 1]);
        }
      }
    });

    it('each activity on day 1 satisfies at least one of the two participants', async () => {
      vi.mocked(anthropic.complete)
        .mockResolvedValueOnce({ content: CONFLICT_ANALYSIS_RESPONSE, latencyMs: 300, tokensUsed: 200 })
        .mockResolvedValueOnce({ content: COMPROMISE_RESPONSE, latencyMs: 400, tokensUsed: 280 });

      const analysis = await analyzer.analyze(TRIP_ID, 1, [ALICE_PROPOSAL, BOB_PROPOSAL]);
      const compromise = await generator.generateCompromise(TRIP_ID, 1, analysis.content, TRIP_CONTEXT);
      const content = compromise.content as CompromiseContent;

      const day1 = content.itinerary.find((d) => d.day === 1);
      expect(day1).toBeDefined();

      for (const activity of day1!.activities) {
        const participantsSatisfied = activity.satisfies.filter((a) =>
          ['alice', 'bob'].includes(a),
        );
        expect(participantsSatisfied.length).toBeGreaterThan(0);
      }
    });
  });

  // -------------------------------------------------------------------------
  describe('Error scenarios', () => {
    it('ConflictAnalyzer wraps non-JSON Claude response as { raw: string }', async () => {
      vi.mocked(anthropic.complete).mockResolvedValue({
        content: NON_JSON_RESPONSE,
        latencyMs: 200,
        tokensUsed: 30,
      });

      const event = await analyzer.analyze(TRIP_ID, 1, [ALICE_PROPOSAL, BOB_PROPOSAL]);

      expect(event.content).toEqual({ raw: NON_JSON_RESPONSE });
    });

    it('CompromiseGenerator wraps non-JSON Claude response as { raw: string }', async () => {
      vi.mocked(anthropic.complete).mockResolvedValue({
        content: NON_JSON_RESPONSE,
        latencyMs: 200,
        tokensUsed: 30,
      });

      const conflictAnalysis = JSON.parse(CONFLICT_ANALYSIS_RESPONSE);
      const event = await generator.generateCompromise(TRIP_ID, 1, conflictAnalysis, TRIP_CONTEXT);

      expect(event.content).toEqual({ raw: NON_JSON_RESPONSE });
    });

    it('ConflictAnalyzer with empty proposals array still calls Claude', async () => {
      vi.mocked(anthropic.complete).mockResolvedValue({
        content: CONFLICT_ANALYSIS_RESPONSE,
        latencyMs: 250,
        tokensUsed: 180,
      });

      const event = await analyzer.analyze(TRIP_ID, 1, []);

      expect(anthropic.complete).toHaveBeenCalledOnce();
      expect(event.agent).toBe('orchestrator');
    });

    it('negotiation loop stops at round 4 even if conflicts persist', async () => {
      // All 4 rounds return high conflict — loop must not exceed MAX_ROUNDS
      vi.mocked(anthropic.complete).mockResolvedValue({
        content: HIGH_CONFLICT_ANALYSIS_RESPONSE, // overallConflictScore: 4.0
        latencyMs: 300,
        tokensUsed: 200,
      });

      const MAX_ROUNDS = 4;
      let roundsRun = 0;
      let converged = false;

      for (let round = 1; round <= MAX_ROUNDS; round++) {
        const analysis = await analyzer.analyze(TRIP_ID, round, [ALICE_PROPOSAL, BOB_PROPOSAL]);
        const content = analysis.content as ConflictAnalysisContent;
        roundsRun = round;

        if (content.overallConflictScore < 1.0) {
          converged = true;
          break;
        }
      }

      expect(roundsRun).toBe(MAX_ROUNDS);
      expect(converged).toBe(false);
      expect(anthropic.complete).toHaveBeenCalledTimes(MAX_ROUNDS);
    });

    it('ConflictAnalyzer propagates Claude service errors', async () => {
      vi.mocked(anthropic.complete).mockRejectedValue(new Error('Anthropic API unavailable'));

      await expect(
        analyzer.analyze(TRIP_ID, 1, [ALICE_PROPOSAL, BOB_PROPOSAL]),
      ).rejects.toThrow();
    });

    it('CompromiseGenerator propagates Claude service errors', async () => {
      vi.mocked(anthropic.complete).mockRejectedValue(new Error('Anthropic API unavailable'));

      const conflictAnalysis = JSON.parse(CONFLICT_ANALYSIS_RESPONSE);
      await expect(
        generator.generateCompromise(TRIP_ID, 1, conflictAnalysis, TRIP_CONTEXT),
      ).rejects.toThrow();
    });
  });
});

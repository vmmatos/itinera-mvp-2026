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
import { ProposalRefiner } from '@/agents/ProposalRefiner';
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
  CARLOS_PROPOSAL,
  ELENA_PROPOSAL,
  HARD_CONSTRAINT_CONFLICT_ANALYSIS_RESPONSE,
  ADAPTING_CONFLICT_ANALYSIS_RESPONSE,
  CONVERGENCE_ANALYSIS_RESPONSE,
  HARD_CONSTRAINT_COMPROMISE_RESPONSE,
  REFINED_HARD_CONSTRAINT_RESPONSE,
  NON_JSON_RESPONSE,
} from './helpers/inflexible-traveller-fixtures';

interface HardConstraint {
  agent: string;
  topic: string;
  flexibility: string;
  description: string;
}

interface ConflictAnalysisContent {
  conflicts: Array<{ agents: string[]; topic: string; description: string; severity: number }>;
  hardConstraints: HardConstraint[];
  consensusAreas: Array<{ topic: string; agents: string[] }>;
  overallConflictScore: number;
  roundSummary: string;
}

interface InflexibleActivity {
  time: string;
  activity: string;
  cost: number;
  currency: string;
  satisfies: string[];
}

interface CompromiseContent {
  itinerary: Array<{ day: number; activities: InflexibleActivity[] }>;
  satisfactionEstimates: Record<string, number>;
  unresolvedConflicts: unknown[];
  compromiseRationale: string;
}

interface RefinedContent {
  changesApplied: string[];
  itinerary: Array<{ day: number; activities: InflexibleActivity[] }>;
  satisfactionEstimates: Record<string, number>;
  unresolvedConflicts: unknown[];
  compromiseRationale: string;
}

const ALL_PROPOSALS = [ALICE_PROPOSAL, BOB_PROPOSAL, CARLOS_PROPOSAL, ELENA_PROPOSAL];

describe('Scenario 005 — 4 people, one inflexible traveller, Sintra+Cascais, €600 budget', () => {
  let anthropic: AnthropicService;
  let publisher: RabbitMQPublisher;
  let redis: RedisService;
  let storage: ProposalStorageService;
  let analyzer: ConflictAnalyzer;
  let generator: CompromiseGenerator;
  let refiner: ProposalRefiner;

  beforeEach(() => {
    vi.clearAllMocks();
    anthropic = new AnthropicService();
    publisher = new RabbitMQPublisher();
    redis = new RedisService();
    storage = new ProposalStorageService();
    analyzer = new ConflictAnalyzer(anthropic, publisher, redis, storage);
    generator = new CompromiseGenerator(anthropic, publisher, redis, storage);
    refiner = new ProposalRefiner(anthropic, publisher, redis, storage);

    vi.mocked(redis.get).mockResolvedValue(null);
    vi.mocked(redis.set).mockResolvedValue(undefined);
    vi.mocked(storage.save).mockResolvedValue(undefined);
    vi.mocked(publisher.publish).mockResolvedValue(undefined);
  });

  // -------------------------------------------------------------------------
  describe('ConflictAnalyzer — hard constraint recognition', () => {
    beforeEach(() => {
      vi.mocked(anthropic.complete).mockResolvedValue({
        content: HARD_CONSTRAINT_CONFLICT_ANALYSIS_RESPONSE,
        latencyMs: 420,
        tokensUsed: 310,
      });
    });

    it('returns overallConflictScore > 2.0 in round 1 due to Elena\'s hard constraint', async () => {
      const event = await analyzer.analyze(TRIP_ID, 1, ALL_PROPOSALS);
      const content = event.content as ConflictAnalysisContent;

      expect(content.overallConflictScore).toBeGreaterThan(2.0);
    });

    it('identifies hardConstraints array with Elena\'s entry', async () => {
      const event = await analyzer.analyze(TRIP_ID, 1, ALL_PROPOSALS);
      const content = event.content as ConflictAnalysisContent;

      expect(content.hardConstraints).toBeDefined();
      expect(content.hardConstraints).toHaveLength(1);
    });

    it('hardConstraints[0] references Elena with flexibility=low', async () => {
      const event = await analyzer.analyze(TRIP_ID, 1, ALL_PROPOSALS);
      const content = event.content as ConflictAnalysisContent;

      const constraint = content.hardConstraints[0];
      expect(constraint.agent).toBe('elena');
      expect(constraint.flexibility).toBe('low');
      expect(constraint.topic).toBe('beach_coastal');
    });

    it('produces a valid AgentEvent with required fields', async () => {
      const event = await analyzer.analyze(TRIP_ID, 1, ALL_PROPOSALS);

      expect(event.tripId).toBe(TRIP_ID);
      expect(event.round).toBe(1);
      expect(event.type).toBe('agent.score');
      expect(event.agent).toBe('orchestrator');
      expect(event.timestamp).toBeDefined();
      expect(event.metrics?.latencyMs).toBe(420);
      expect(event.metrics?.tokensUsed).toBe(310);
    });

    it('publishes to routing key agent.orchestrator.score', async () => {
      await analyzer.analyze(TRIP_ID, 1, ALL_PROPOSALS);

      expect(publisher.publish).toHaveBeenCalledWith(
        'agent.orchestrator.score',
        expect.any(Object),
      );
    });

    it('publishes event to RabbitMQ on cache miss', async () => {
      await analyzer.analyze(TRIP_ID, 1, ALL_PROPOSALS);

      expect(publisher.publish).toHaveBeenCalledOnce();
    });

    it('cache hit returns cached event without calling Claude', async () => {
      const cachedEvent: AgentEvent = {
        tripId: TRIP_ID,
        type: 'agent.score',
        agent: 'orchestrator',
        round: 1,
        timestamp: new Date().toISOString(),
        content: JSON.parse(HARD_CONSTRAINT_CONFLICT_ANALYSIS_RESPONSE),
      };
      vi.mocked(redis.get).mockResolvedValue(cachedEvent);

      const event = await analyzer.analyze(TRIP_ID, 1, ALL_PROPOSALS);

      expect(anthropic.complete).not.toHaveBeenCalled();
      expect(storage.save).not.toHaveBeenCalled();
      expect(publisher.publish).not.toHaveBeenCalled();
      expect(event).toEqual(cachedEvent);
    });
  });

  // -------------------------------------------------------------------------
  describe('CompromiseGenerator — inflexible traveller satisfaction', () => {
    beforeEach(() => {
      vi.mocked(anthropic.complete).mockResolvedValue({
        content: HARD_CONSTRAINT_COMPROMISE_RESPONSE,
        latencyMs: 560,
        tokensUsed: 430,
      });
    });

    it('satisfactionEstimates.elena ≥ 0.90 — hard constraint respected', async () => {
      const conflictAnalysis = JSON.parse(HARD_CONSTRAINT_CONFLICT_ANALYSIS_RESPONSE);
      const event = await generator.generateCompromise(TRIP_ID, 1, conflictAnalysis, TRIP_CONTEXT);
      const content = event.content as CompromiseContent;

      expect(content.satisfactionEstimates['elena']).toBeGreaterThanOrEqual(0.9);
    });

    it('satisfactionEstimates.alice ≥ 0.65 — rest of group adapts but not punished', async () => {
      const conflictAnalysis = JSON.parse(HARD_CONSTRAINT_CONFLICT_ANALYSIS_RESPONSE);
      const event = await generator.generateCompromise(TRIP_ID, 1, conflictAnalysis, TRIP_CONTEXT);
      const content = event.content as CompromiseContent;

      expect(content.satisfactionEstimates['alice']).toBeGreaterThanOrEqual(0.65);
    });

    it('satisfactionEstimates.bob ≥ 0.65', async () => {
      const conflictAnalysis = JSON.parse(HARD_CONSTRAINT_CONFLICT_ANALYSIS_RESPONSE);
      const event = await generator.generateCompromise(TRIP_ID, 1, conflictAnalysis, TRIP_CONTEXT);
      const content = event.content as CompromiseContent;

      expect(content.satisfactionEstimates['bob']).toBeGreaterThanOrEqual(0.65);
    });

    it('satisfactionEstimates.carlos ≥ 0.65', async () => {
      const conflictAnalysis = JSON.parse(HARD_CONSTRAINT_CONFLICT_ANALYSIS_RESPONSE);
      const event = await generator.generateCompromise(TRIP_ID, 1, conflictAnalysis, TRIP_CONTEXT);
      const content = event.content as CompromiseContent;

      expect(content.satisfactionEstimates['carlos']).toBeGreaterThanOrEqual(0.65);
    });

    it('unresolvedConflicts is empty — full convergence', async () => {
      const conflictAnalysis = JSON.parse(HARD_CONSTRAINT_CONFLICT_ANALYSIS_RESPONSE);
      const event = await generator.generateCompromise(TRIP_ID, 1, conflictAnalysis, TRIP_CONTEXT);
      const content = event.content as CompromiseContent;

      expect(content.unresolvedConflicts).toHaveLength(0);
    });

    it('itinerary covers both day 1 and day 2', async () => {
      const conflictAnalysis = JSON.parse(HARD_CONSTRAINT_CONFLICT_ANALYSIS_RESPONSE);
      const event = await generator.generateCompromise(TRIP_ID, 1, conflictAnalysis, TRIP_CONTEXT);
      const content = event.content as CompromiseContent;

      const days = content.itinerary.map((d) => d.day);
      expect(days).toContain(1);
      expect(days).toContain(2);
    });

    it('produces a valid AgentEvent with required fields', async () => {
      const conflictAnalysis = JSON.parse(HARD_CONSTRAINT_CONFLICT_ANALYSIS_RESPONSE);
      const event = await generator.generateCompromise(TRIP_ID, 1, conflictAnalysis, TRIP_CONTEXT);

      expect(event.tripId).toBe(TRIP_ID);
      expect(event.round).toBe(1);
      expect(event.type).toBe('agent.propose');
      expect(event.agent).toBe('orchestrator');
      expect(event.timestamp).toBeDefined();
    });

    it('publishes compromise event to RabbitMQ', async () => {
      const conflictAnalysis = JSON.parse(HARD_CONSTRAINT_CONFLICT_ANALYSIS_RESPONSE);
      await generator.generateCompromise(TRIP_ID, 1, conflictAnalysis, TRIP_CONTEXT);

      expect(publisher.publish).toHaveBeenCalledOnce();
    });
  });

  // -------------------------------------------------------------------------
  describe('ProposalRefiner — hard constraint feedback incorporation', () => {
    const HARD_CONSTRAINT_FEEDBACK =
      "Elena has flexibility=low — beach activities are non-negotiable on both days. Ensure the itinerary preserves beach anchor activities for Elena and that her satisfaction remains ≥90%.";

    beforeEach(() => {
      vi.mocked(anthropic.complete).mockResolvedValue({
        content: REFINED_HARD_CONSTRAINT_RESPONSE,
        latencyMs: 490,
        tokensUsed: 380,
      });
    });

    it('always calls Claude — no caching for refinements', async () => {
      const proposal = JSON.parse(HARD_CONSTRAINT_COMPROMISE_RESPONSE);

      await refiner.refine(TRIP_ID, 2, proposal, HARD_CONSTRAINT_FEEDBACK, TRIP_CONTEXT);
      await refiner.refine(TRIP_ID, 2, proposal, HARD_CONSTRAINT_FEEDBACK, TRIP_CONTEXT);

      expect(anthropic.complete).toHaveBeenCalledTimes(2);
      expect(redis.get).not.toHaveBeenCalled();
    });

    it('refined result contains changesApplied array', async () => {
      const proposal = JSON.parse(HARD_CONSTRAINT_COMPROMISE_RESPONSE);
      const event = await refiner.refine(TRIP_ID, 2, proposal, HARD_CONSTRAINT_FEEDBACK, TRIP_CONTEXT);
      const content = event.content as RefinedContent;

      expect(content.changesApplied).toBeDefined();
      expect(content.changesApplied.length).toBeGreaterThan(0);
    });

    it('refined result maintains Elena satisfaction ≥ 0.90', async () => {
      const proposal = JSON.parse(HARD_CONSTRAINT_COMPROMISE_RESPONSE);
      const event = await refiner.refine(TRIP_ID, 2, proposal, HARD_CONSTRAINT_FEEDBACK, TRIP_CONTEXT);
      const content = event.content as RefinedContent;

      expect(content.satisfactionEstimates['elena']).toBeGreaterThanOrEqual(0.9);
    });

    it('publishes to routing key agent.orchestrator.refine', async () => {
      const proposal = JSON.parse(HARD_CONSTRAINT_COMPROMISE_RESPONSE);
      await refiner.refine(TRIP_ID, 2, proposal, HARD_CONSTRAINT_FEEDBACK, TRIP_CONTEXT);

      expect(publisher.publish).toHaveBeenCalledWith(
        'agent.orchestrator.refine',
        expect.any(Object),
      );
    });
  });

  // -------------------------------------------------------------------------
  describe('End-to-end negotiation flow', () => {
    it('converges within 6 rounds — Elena\'s hard constraint drives multi-round adaptation', async () => {
      vi.mocked(anthropic.complete)
        .mockResolvedValueOnce({
          content: HARD_CONSTRAINT_CONFLICT_ANALYSIS_RESPONSE, // score: 3.2
          latencyMs: 420,
          tokensUsed: 310,
        })
        .mockResolvedValueOnce({
          content: ADAPTING_CONFLICT_ANALYSIS_RESPONSE, // score: 1.4
          latencyMs: 390,
          tokensUsed: 285,
        })
        .mockResolvedValueOnce({
          content: CONVERGENCE_ANALYSIS_RESPONSE, // score: 0.6
          latencyMs: 360,
          tokensUsed: 260,
        })
        .mockResolvedValueOnce({
          content: HARD_CONSTRAINT_COMPROMISE_RESPONSE,
          latencyMs: 560,
          tokensUsed: 430,
        });

      const MAX_ROUNDS = 6;
      let roundsCompleted = 0;
      let compromise: AgentEvent | null = null;

      for (let round = 1; round <= MAX_ROUNDS; round++) {
        const analysis = await analyzer.analyze(TRIP_ID, round, ALL_PROPOSALS);
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

    it('Elena satisfactionEstimates ≥ 0.90 in final compromise', async () => {
      vi.mocked(anthropic.complete)
        .mockResolvedValueOnce({
          content: CONVERGENCE_ANALYSIS_RESPONSE,
          latencyMs: 360,
          tokensUsed: 260,
        })
        .mockResolvedValueOnce({
          content: HARD_CONSTRAINT_COMPROMISE_RESPONSE,
          latencyMs: 560,
          tokensUsed: 430,
        });

      const analysis = await analyzer.analyze(TRIP_ID, 3, ALL_PROPOSALS);
      const compromise = await generator.generateCompromise(
        TRIP_ID,
        3,
        analysis.content,
        TRIP_CONTEXT,
      );
      const content = compromise.content as CompromiseContent;

      expect(content.satisfactionEstimates['elena']).toBeGreaterThanOrEqual(0.9);
    });

    it('final compromise budget ≤ €600 for 4 people', async () => {
      vi.mocked(anthropic.complete)
        .mockResolvedValueOnce({
          content: CONVERGENCE_ANALYSIS_RESPONSE,
          latencyMs: 360,
          tokensUsed: 260,
        })
        .mockResolvedValueOnce({
          content: HARD_CONSTRAINT_COMPROMISE_RESPONSE,
          latencyMs: 560,
          tokensUsed: 430,
        });

      const analysis = await analyzer.analyze(TRIP_ID, 3, ALL_PROPOSALS);
      const compromise = await generator.generateCompromise(
        TRIP_ID,
        3,
        analysis.content,
        TRIP_CONTEXT,
      );
      const content = compromise.content as CompromiseContent;

      const totalPerPerson = content.itinerary
        .flatMap((day) => day.activities)
        .reduce((sum, act) => sum + act.cost, 0);

      expect(totalPerPerson * 4).toBeLessThanOrEqual(600);
    });

    it('no logistical conflicts — activity times do not overlap within a day', async () => {
      vi.mocked(anthropic.complete)
        .mockResolvedValueOnce({
          content: CONVERGENCE_ANALYSIS_RESPONSE,
          latencyMs: 360,
          tokensUsed: 260,
        })
        .mockResolvedValueOnce({
          content: HARD_CONSTRAINT_COMPROMISE_RESPONSE,
          latencyMs: 560,
          tokensUsed: 430,
        });

      const analysis = await analyzer.analyze(TRIP_ID, 3, ALL_PROPOSALS);
      const compromise = await generator.generateCompromise(
        TRIP_ID,
        3,
        analysis.content,
        TRIP_CONTEXT,
      );
      const content = compromise.content as CompromiseContent;

      for (const day of content.itinerary) {
        const startMinutes = day.activities.map((act) => {
          const [h, m] = act.time.split(':').map(Number);
          return h * 60 + m;
        });

        for (let i = 1; i < startMinutes.length; i++) {
          expect(startMinutes[i]).toBeGreaterThan(startMinutes[i - 1]);
        }
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

      const event = await analyzer.analyze(TRIP_ID, 1, ALL_PROPOSALS);

      expect(event.content).toEqual({ raw: NON_JSON_RESPONSE });
    });

    it('CompromiseGenerator wraps non-JSON Claude response as { raw: string }', async () => {
      vi.mocked(anthropic.complete).mockResolvedValue({
        content: NON_JSON_RESPONSE,
        latencyMs: 200,
        tokensUsed: 30,
      });

      const conflictAnalysis = JSON.parse(HARD_CONSTRAINT_CONFLICT_ANALYSIS_RESPONSE);
      const event = await generator.generateCompromise(TRIP_ID, 1, conflictAnalysis, TRIP_CONTEXT);

      expect(event.content).toEqual({ raw: NON_JSON_RESPONSE });
    });

    it('negotiation loop stops at round 6 even if hard-constraint conflicts persist', async () => {
      vi.mocked(anthropic.complete).mockResolvedValue({
        content: HARD_CONSTRAINT_CONFLICT_ANALYSIS_RESPONSE, // score: 3.2 — never converges
        latencyMs: 300,
        tokensUsed: 200,
      });

      const MAX_ROUNDS = 6;
      let roundsRun = 0;
      let converged = false;

      for (let round = 1; round <= MAX_ROUNDS; round++) {
        const analysis = await analyzer.analyze(TRIP_ID, round, ALL_PROPOSALS);
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

      await expect(analyzer.analyze(TRIP_ID, 1, ALL_PROPOSALS)).rejects.toThrow();
    });

    it('CompromiseGenerator propagates Claude service errors', async () => {
      vi.mocked(anthropic.complete).mockRejectedValue(new Error('Anthropic API unavailable'));

      const conflictAnalysis = JSON.parse(HARD_CONSTRAINT_CONFLICT_ANALYSIS_RESPONSE);
      await expect(
        generator.generateCompromise(TRIP_ID, 1, conflictAnalysis, TRIP_CONTEXT),
      ).rejects.toThrow();
    });
  });
});

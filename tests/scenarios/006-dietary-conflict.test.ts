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
  DIANA_PROPOSAL,
  DIETARY_CONFLICT_ANALYSIS_RESPONSE,
  ADAPTING_CONFLICT_ANALYSIS_RESPONSE,
  CONVERGENCE_ANALYSIS_RESPONSE,
  DIETARY_COMPROMISE_RESPONSE,
  NON_JSON_RESPONSE,
} from './helpers/dietary-conflict-fixtures';

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

interface DietaryActivity {
  time: string;
  activity: string;
  cost: number;
  currency: string;
  satisfies: string[];
  dietaryNote?: string;
}

interface CompromiseContent {
  itinerary: Array<{ day: number; activities: DietaryActivity[] }>;
  satisfactionEstimates: Record<string, number>;
  unresolvedConflicts: unknown[];
  compromiseRationale: string;
  mealsValidated: boolean;
}

const ALL_PROPOSALS = [ALICE_PROPOSAL, DIANA_PROPOSAL];
const BUDGET_TOTAL = 400;

describe('Scenario 006 — Alice (vegan) + Diana (fine dining), Sintra+Cascais, 2 days, €400 budget', () => {
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

  // ---------------------------------------------------------------------------
  describe('ConflictAnalyzer — dietary hard constraint recognition', () => {
    beforeEach(() => {
      vi.mocked(anthropic.complete).mockResolvedValue({
        content: DIETARY_CONFLICT_ANALYSIS_RESPONSE,
        latencyMs: 420,
        tokensUsed: 310,
      });
    });

    it('returns overallConflictScore > 2.0 in round 1 due to dietary conflict', async () => {
      const event = await analyzer.analyze(TRIP_ID, 1, ALL_PROPOSALS);
      const content = event.content as ConflictAnalysisContent;

      expect(content.overallConflictScore).toBeGreaterThan(2.0);
    });

    it('identifies hardConstraints array with Alice\'s vegan entry', async () => {
      const event = await analyzer.analyze(TRIP_ID, 1, ALL_PROPOSALS);
      const content = event.content as ConflictAnalysisContent;

      expect(content.hardConstraints).toBeDefined();
      expect(content.hardConstraints).toHaveLength(1);
    });

    it('hardConstraints[0] references alice with topic=dietary_vegan and flexibility=none', async () => {
      const event = await analyzer.analyze(TRIP_ID, 1, ALL_PROPOSALS);
      const content = event.content as ConflictAnalysisContent;

      const constraint = content.hardConstraints[0];
      expect(constraint.agent).toBe('alice');
      expect(constraint.flexibility).toBe('none');
      expect(constraint.topic).toBe('dietary_vegan');
    });

    it('conflicts include meal_incompatibility topic with severity ≥ 4', async () => {
      const event = await analyzer.analyze(TRIP_ID, 1, ALL_PROPOSALS);
      const content = event.content as ConflictAnalysisContent;

      const mealConflict = content.conflicts.find((c) => c.topic === 'meal_incompatibility');
      expect(mealConflict).toBeDefined();
      expect(mealConflict!.severity).toBeGreaterThanOrEqual(4);
    });

    it('meal_incompatibility conflict involves both alice and diana', async () => {
      const event = await analyzer.analyze(TRIP_ID, 1, ALL_PROPOSALS);
      const content = event.content as ConflictAnalysisContent;

      const mealConflict = content.conflicts.find((c) => c.topic === 'meal_incompatibility');
      expect(mealConflict!.agents).toContain('alice');
      expect(mealConflict!.agents).toContain('diana');
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
        content: JSON.parse(DIETARY_CONFLICT_ANALYSIS_RESPONSE),
      };
      vi.mocked(redis.get).mockResolvedValue(cachedEvent);

      const event = await analyzer.analyze(TRIP_ID, 1, ALL_PROPOSALS);

      expect(anthropic.complete).not.toHaveBeenCalled();
      expect(storage.save).not.toHaveBeenCalled();
      expect(publisher.publish).not.toHaveBeenCalled();
      expect(event).toEqual(cachedEvent);
    });
  });

  // ---------------------------------------------------------------------------
  describe('CompromiseGenerator — vegan constraint respected, both travellers viable', () => {
    beforeEach(() => {
      vi.mocked(anthropic.complete).mockResolvedValue({
        content: DIETARY_COMPROMISE_RESPONSE,
        latencyMs: 540,
        tokensUsed: 420,
      });
    });

    it('satisfactionEstimates.alice ≥ 0.80 — vegan constraint respected', async () => {
      const conflictAnalysis = JSON.parse(DIETARY_CONFLICT_ANALYSIS_RESPONSE);
      const event = await generator.generateCompromise(TRIP_ID, 1, conflictAnalysis, TRIP_CONTEXT);
      const content = event.content as CompromiseContent;

      expect(content.satisfactionEstimates['alice']).toBeGreaterThanOrEqual(0.8);
    });

    it('satisfactionEstimates.diana ≥ 0.75 — fine dining quality preserved', async () => {
      const conflictAnalysis = JSON.parse(DIETARY_CONFLICT_ANALYSIS_RESPONSE);
      const event = await generator.generateCompromise(TRIP_ID, 1, conflictAnalysis, TRIP_CONTEXT);
      const content = event.content as CompromiseContent;

      expect(content.satisfactionEstimates['diana']).toBeGreaterThanOrEqual(0.75);
    });

    it('mealsValidated === true — logistics confirmed vegan-friendly venues in region', async () => {
      const conflictAnalysis = JSON.parse(DIETARY_CONFLICT_ANALYSIS_RESPONSE);
      const event = await generator.generateCompromise(TRIP_ID, 1, conflictAnalysis, TRIP_CONTEXT);
      const content = event.content as CompromiseContent;

      expect(content.mealsValidated).toBe(true);
    });

    it('all meal activities carry dietaryNote=vegan_option_available', async () => {
      const conflictAnalysis = JSON.parse(DIETARY_CONFLICT_ANALYSIS_RESPONSE);
      const event = await generator.generateCompromise(TRIP_ID, 1, conflictAnalysis, TRIP_CONTEXT);
      const content = event.content as CompromiseContent;

      const mealActivities = content.itinerary
        .flatMap((day) => day.activities)
        .filter((act) => act.dietaryNote !== undefined);

      expect(mealActivities.length).toBeGreaterThanOrEqual(2);
      for (const act of mealActivities) {
        expect(act.dietaryNote).toBe('vegan_option_available');
      }
    });

    it('every meal slot satisfies alice — alice has a viable meal option', async () => {
      const conflictAnalysis = JSON.parse(DIETARY_CONFLICT_ANALYSIS_RESPONSE);
      const event = await generator.generateCompromise(TRIP_ID, 1, conflictAnalysis, TRIP_CONTEXT);
      const content = event.content as CompromiseContent;

      const mealActivities = content.itinerary
        .flatMap((day) => day.activities)
        .filter((act) => act.dietaryNote !== undefined);

      for (const act of mealActivities) {
        expect(act.satisfies).toContain('alice');
      }
    });

    it('every meal slot satisfies diana — diana has a viable meal option', async () => {
      const conflictAnalysis = JSON.parse(DIETARY_CONFLICT_ANALYSIS_RESPONSE);
      const event = await generator.generateCompromise(TRIP_ID, 1, conflictAnalysis, TRIP_CONTEXT);
      const content = event.content as CompromiseContent;

      const mealActivities = content.itinerary
        .flatMap((day) => day.activities)
        .filter((act) => act.dietaryNote !== undefined);

      for (const act of mealActivities) {
        expect(act.satisfies).toContain('diana');
      }
    });

    it('every meal activity satisfies both alice and diana — no meal constraint violated', async () => {
      const conflictAnalysis = JSON.parse(DIETARY_CONFLICT_ANALYSIS_RESPONSE);
      const event = await generator.generateCompromise(TRIP_ID, 1, conflictAnalysis, TRIP_CONTEXT);
      const content = event.content as CompromiseContent;

      const mealActivities = content.itinerary
        .flatMap((day) => day.activities)
        .filter((act) => act.dietaryNote === 'vegan_option_available');

      for (const act of mealActivities) {
        expect(act.satisfies).toContain('alice');
        expect(act.satisfies).toContain('diana');
      }
    });

    it('unresolvedConflicts is empty — full convergence', async () => {
      const conflictAnalysis = JSON.parse(DIETARY_CONFLICT_ANALYSIS_RESPONSE);
      const event = await generator.generateCompromise(TRIP_ID, 1, conflictAnalysis, TRIP_CONTEXT);
      const content = event.content as CompromiseContent;

      expect(content.unresolvedConflicts).toHaveLength(0);
    });

    it('itinerary covers both day 1 (Sintra) and day 2 (Cascais)', async () => {
      const conflictAnalysis = JSON.parse(DIETARY_CONFLICT_ANALYSIS_RESPONSE);
      const event = await generator.generateCompromise(TRIP_ID, 1, conflictAnalysis, TRIP_CONTEXT);
      const content = event.content as CompromiseContent;

      const days = content.itinerary.map((d) => d.day);
      expect(days).toContain(1);
      expect(days).toContain(2);
    });

    it('produces a valid AgentEvent with required fields', async () => {
      const conflictAnalysis = JSON.parse(DIETARY_CONFLICT_ANALYSIS_RESPONSE);
      const event = await generator.generateCompromise(TRIP_ID, 1, conflictAnalysis, TRIP_CONTEXT);

      expect(event.tripId).toBe(TRIP_ID);
      expect(event.round).toBe(1);
      expect(event.type).toBe('agent.propose');
      expect(event.agent).toBe('orchestrator');
      expect(event.timestamp).toBeDefined();
    });

    it('publishes compromise event to RabbitMQ', async () => {
      const conflictAnalysis = JSON.parse(DIETARY_CONFLICT_ANALYSIS_RESPONSE);
      await generator.generateCompromise(TRIP_ID, 1, conflictAnalysis, TRIP_CONTEXT);

      expect(publisher.publish).toHaveBeenCalledOnce();
    });
  });

  // ---------------------------------------------------------------------------
  describe('End-to-end negotiation flow', () => {
    it('converges within 4 rounds — dietary hard constraint drives resolution', async () => {
      vi.mocked(anthropic.complete)
        .mockResolvedValueOnce({
          content: DIETARY_CONFLICT_ANALYSIS_RESPONSE, // score: 2.8
          latencyMs: 420,
          tokensUsed: 310,
        })
        .mockResolvedValueOnce({
          content: ADAPTING_CONFLICT_ANALYSIS_RESPONSE, // score: 1.2
          latencyMs: 380,
          tokensUsed: 275,
        })
        .mockResolvedValueOnce({
          content: CONVERGENCE_ANALYSIS_RESPONSE, // score: 0.5
          latencyMs: 350,
          tokensUsed: 250,
        })
        .mockResolvedValueOnce({
          content: DIETARY_COMPROMISE_RESPONSE,
          latencyMs: 540,
          tokensUsed: 420,
        });

      const MAX_ROUNDS = 4;
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

    it('alice satisfactionEstimates ≥ 0.80 in final compromise', async () => {
      vi.mocked(anthropic.complete)
        .mockResolvedValueOnce({
          content: CONVERGENCE_ANALYSIS_RESPONSE,
          latencyMs: 350,
          tokensUsed: 250,
        })
        .mockResolvedValueOnce({
          content: DIETARY_COMPROMISE_RESPONSE,
          latencyMs: 540,
          tokensUsed: 420,
        });

      const analysis = await analyzer.analyze(TRIP_ID, 3, ALL_PROPOSALS);
      const compromise = await generator.generateCompromise(TRIP_ID, 3, analysis.content, TRIP_CONTEXT);
      const content = compromise.content as CompromiseContent;

      expect(content.satisfactionEstimates['alice']).toBeGreaterThanOrEqual(0.8);
    });

    it('diana satisfactionEstimates ≥ 0.75 in final compromise', async () => {
      vi.mocked(anthropic.complete)
        .mockResolvedValueOnce({
          content: CONVERGENCE_ANALYSIS_RESPONSE,
          latencyMs: 350,
          tokensUsed: 250,
        })
        .mockResolvedValueOnce({
          content: DIETARY_COMPROMISE_RESPONSE,
          latencyMs: 540,
          tokensUsed: 420,
        });

      const analysis = await analyzer.analyze(TRIP_ID, 3, ALL_PROPOSALS);
      const compromise = await generator.generateCompromise(TRIP_ID, 3, analysis.content, TRIP_CONTEXT);
      const content = compromise.content as CompromiseContent;

      expect(content.satisfactionEstimates['diana']).toBeGreaterThanOrEqual(0.75);
    });

    it('final compromise budget ≤ €400 for 2 people', async () => {
      vi.mocked(anthropic.complete)
        .mockResolvedValueOnce({
          content: CONVERGENCE_ANALYSIS_RESPONSE,
          latencyMs: 350,
          tokensUsed: 250,
        })
        .mockResolvedValueOnce({
          content: DIETARY_COMPROMISE_RESPONSE,
          latencyMs: 540,
          tokensUsed: 420,
        });

      const analysis = await analyzer.analyze(TRIP_ID, 3, ALL_PROPOSALS);
      const compromise = await generator.generateCompromise(TRIP_ID, 3, analysis.content, TRIP_CONTEXT);
      const content = compromise.content as CompromiseContent;

      const perPersonTotal = content.itinerary
        .flatMap((day) => day.activities)
        .reduce((sum, act) => sum + act.cost, 0);

      expect(perPersonTotal * 2).toBeLessThanOrEqual(BUDGET_TOTAL);
    });

    it('no logistical conflicts — activity times do not overlap within a day', async () => {
      vi.mocked(anthropic.complete)
        .mockResolvedValueOnce({
          content: CONVERGENCE_ANALYSIS_RESPONSE,
          latencyMs: 350,
          tokensUsed: 250,
        })
        .mockResolvedValueOnce({
          content: DIETARY_COMPROMISE_RESPONSE,
          latencyMs: 540,
          tokensUsed: 420,
        });

      const analysis = await analyzer.analyze(TRIP_ID, 3, ALL_PROPOSALS);
      const compromise = await generator.generateCompromise(TRIP_ID, 3, analysis.content, TRIP_CONTEXT);
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

    it('mealsValidated true in final compromise — logistics validated vegan options in region', async () => {
      vi.mocked(anthropic.complete)
        .mockResolvedValueOnce({
          content: CONVERGENCE_ANALYSIS_RESPONSE,
          latencyMs: 350,
          tokensUsed: 250,
        })
        .mockResolvedValueOnce({
          content: DIETARY_COMPROMISE_RESPONSE,
          latencyMs: 540,
          tokensUsed: 420,
        });

      const analysis = await analyzer.analyze(TRIP_ID, 3, ALL_PROPOSALS);
      const compromise = await generator.generateCompromise(TRIP_ID, 3, analysis.content, TRIP_CONTEXT);
      const content = compromise.content as CompromiseContent;

      expect(content.mealsValidated).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
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

      const conflictAnalysis = JSON.parse(DIETARY_CONFLICT_ANALYSIS_RESPONSE);
      const event = await generator.generateCompromise(TRIP_ID, 1, conflictAnalysis, TRIP_CONTEXT);

      expect(event.content).toEqual({ raw: NON_JSON_RESPONSE });
    });

    it('negotiation loop stops at round 4 even if dietary conflicts persist', async () => {
      vi.mocked(anthropic.complete).mockResolvedValue({
        content: DIETARY_CONFLICT_ANALYSIS_RESPONSE, // score: 2.8 — never converges
        latencyMs: 300,
        tokensUsed: 200,
      });

      const MAX_ROUNDS = 4;
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

      const conflictAnalysis = JSON.parse(DIETARY_CONFLICT_ANALYSIS_RESPONSE);
      await expect(
        generator.generateCompromise(TRIP_ID, 1, conflictAnalysis, TRIP_CONTEXT),
      ).rejects.toThrow();
    });
  });
});

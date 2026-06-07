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
  CARLOS_PROPOSAL,
  DIANA_PROPOSAL,
  HIGH_CONFLICT_ANALYSIS_RESPONSE,
  MID_CONFLICT_ANALYSIS_RESPONSE,
  CONVERGENCE_ANALYSIS_RESPONSE,
  COMPROMISE_RESPONSE,
  NON_JSON_RESPONSE,
} from './helpers/sintra-cascais-fixtures';

interface ConflictAnalysisContent {
  conflicts: Array<{ agents: string[]; topic: string; description: string; severity: number }>;
  consensusAreas: Array<{ topic: string; agents: string[] }>;
  overallConflictScore: number;
  roundSummary: string;
}

interface SintraCascaisActivity {
  time: string;
  activity: string;
  cost: number;
  currency: string;
  satisfies: string[];
  description: string;
}

interface CompromiseContent {
  itinerary: Array<{ day: number; activities: SintraCascaisActivity[] }>;
  satisfactionEstimates: Record<string, number>;
  unresolvedConflicts: unknown[];
  compromiseRationale: string;
}

const ALL_AGENTS = ['alice', 'bob', 'carlos', 'diana'] as const;
const ALL_PROPOSALS = [ALICE_PROPOSAL, BOB_PROPOSAL, CARLOS_PROPOSAL, DIANA_PROPOSAL];

describe('Scenario 002 — Alice+Bob+Carlos+Diana, Sintra+Cascais, 2 days, €600 budget', () => {
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
  describe('ConflictAnalyzer — high-conflict 4-agent proposals', () => {
    beforeEach(() => {
      vi.mocked(anthropic.complete).mockResolvedValue({
        content: HIGH_CONFLICT_ANALYSIS_RESPONSE,
        latencyMs: 420,
        tokensUsed: 310,
      });
    });

    it('returns overallConflictScore > 2.0 for conflicting 4-agent proposals', async () => {
      const event = await analyzer.analyze(TRIP_ID, 1, ALL_PROPOSALS);
      const content = event.content as ConflictAnalysisContent;

      expect(content.overallConflictScore).toBeGreaterThan(2.0);
    });

    it('conflicts array has at least 3 distinct conflict pairs', async () => {
      const event = await analyzer.analyze(TRIP_ID, 1, ALL_PROPOSALS);
      const content = event.content as ConflictAnalysisContent;

      expect(content.conflicts.length).toBeGreaterThanOrEqual(3);
    });

    it('identified conflicts cover activity_pace, activity_type, and energy_level topics', async () => {
      const event = await analyzer.analyze(TRIP_ID, 1, ALL_PROPOSALS);
      const content = event.content as ConflictAnalysisContent;

      const topics = content.conflicts.map((c) => c.topic);
      expect(topics).toContain('activity_pace');
      expect(topics).toContain('activity_type');
      expect(topics).toContain('energy_level');
    });

    it('each conflict entry has exactly 2 agents and a severity score', async () => {
      const event = await analyzer.analyze(TRIP_ID, 1, ALL_PROPOSALS);
      const content = event.content as ConflictAnalysisContent;

      for (const conflict of content.conflicts) {
        expect(conflict.agents).toHaveLength(2);
        expect(conflict.severity).toBeGreaterThanOrEqual(1);
        expect(conflict.severity).toBeLessThanOrEqual(5);
      }
    });

    it('consensusAreas includes destination agreed by all 4 agents', async () => {
      const event = await analyzer.analyze(TRIP_ID, 1, ALL_PROPOSALS);
      const content = event.content as ConflictAnalysisContent;

      const destination = content.consensusAreas.find((a) => a.topic === 'destination');
      expect(destination).toBeDefined();
      for (const agent of ALL_AGENTS) {
        expect(destination?.agents).toContain(agent);
      }
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
        content: JSON.parse(HIGH_CONFLICT_ANALYSIS_RESPONSE),
      };
      vi.mocked(redis.get).mockResolvedValue(cachedEvent);

      const event = await analyzer.analyze(TRIP_ID, 1, ALL_PROPOSALS);

      expect(anthropic.complete).not.toHaveBeenCalled();
      expect(storage.save).not.toHaveBeenCalled();
      expect(publisher.publish).not.toHaveBeenCalled();
      expect(event).toEqual(cachedEvent);
    });

    it('all 4 agent names are included in the Claude prompt', async () => {
      await analyzer.analyze(TRIP_ID, 1, ALL_PROPOSALS);

      const callArgs = vi.mocked(anthropic.complete).mock.calls[0];
      const promptText = JSON.stringify(callArgs);
      for (const agent of ALL_AGENTS) {
        expect(promptText).toContain(agent);
      }
    });
  });

  // -------------------------------------------------------------------------
  describe('CompromiseGenerator — compromise addresses all 4 profiles', () => {
    beforeEach(() => {
      vi.mocked(anthropic.complete).mockResolvedValue({
        content: COMPROMISE_RESPONSE,
        latencyMs: 560,
        tokensUsed: 420,
      });
    });

    it('satisfactionEstimates.alice ≥ 0.65', async () => {
      const conflictAnalysis = JSON.parse(CONVERGENCE_ANALYSIS_RESPONSE);
      const event = await generator.generateCompromise(TRIP_ID, 3, conflictAnalysis, TRIP_CONTEXT);
      const content = event.content as CompromiseContent;

      expect(content.satisfactionEstimates['alice']).toBeGreaterThanOrEqual(0.65);
    });

    it('satisfactionEstimates.bob ≥ 0.65', async () => {
      const conflictAnalysis = JSON.parse(CONVERGENCE_ANALYSIS_RESPONSE);
      const event = await generator.generateCompromise(TRIP_ID, 3, conflictAnalysis, TRIP_CONTEXT);
      const content = event.content as CompromiseContent;

      expect(content.satisfactionEstimates['bob']).toBeGreaterThanOrEqual(0.65);
    });

    it('satisfactionEstimates.carlos ≥ 0.65', async () => {
      const conflictAnalysis = JSON.parse(CONVERGENCE_ANALYSIS_RESPONSE);
      const event = await generator.generateCompromise(TRIP_ID, 3, conflictAnalysis, TRIP_CONTEXT);
      const content = event.content as CompromiseContent;

      expect(content.satisfactionEstimates['carlos']).toBeGreaterThanOrEqual(0.65);
    });

    it('satisfactionEstimates.diana ≥ 0.65', async () => {
      const conflictAnalysis = JSON.parse(CONVERGENCE_ANALYSIS_RESPONSE);
      const event = await generator.generateCompromise(TRIP_ID, 3, conflictAnalysis, TRIP_CONTEXT);
      const content = event.content as CompromiseContent;

      expect(content.satisfactionEstimates['diana']).toBeGreaterThanOrEqual(0.65);
    });

    it('unresolvedConflicts is empty — full convergence', async () => {
      const conflictAnalysis = JSON.parse(CONVERGENCE_ANALYSIS_RESPONSE);
      const event = await generator.generateCompromise(TRIP_ID, 3, conflictAnalysis, TRIP_CONTEXT);
      const content = event.content as CompromiseContent;

      expect(content.unresolvedConflicts).toHaveLength(0);
    });

    it('itinerary covers both day 1 (Sintra) and day 2 (Cascais)', async () => {
      const conflictAnalysis = JSON.parse(CONVERGENCE_ANALYSIS_RESPONSE);
      const event = await generator.generateCompromise(TRIP_ID, 3, conflictAnalysis, TRIP_CONTEXT);
      const content = event.content as CompromiseContent;

      const days = content.itinerary.map((d) => d.day);
      expect(days).toContain(1);
      expect(days).toContain(2);
    });

    it('both Sintra and Cascais are represented across the itinerary', async () => {
      const conflictAnalysis = JSON.parse(CONVERGENCE_ANALYSIS_RESPONSE);
      const event = await generator.generateCompromise(TRIP_ID, 3, conflictAnalysis, TRIP_CONTEXT);
      const content = event.content as CompromiseContent;

      const allActivityText = JSON.stringify(content.itinerary);
      expect(allActivityText).toMatch(/[Ss]intra/);
      expect(allActivityText).toMatch(/[Cc]ascais/);
    });

    it('produces a valid AgentEvent with required fields', async () => {
      const conflictAnalysis = JSON.parse(CONVERGENCE_ANALYSIS_RESPONSE);
      const event = await generator.generateCompromise(TRIP_ID, 3, conflictAnalysis, TRIP_CONTEXT);

      expect(event.tripId).toBe(TRIP_ID);
      expect(event.round).toBe(3);
      expect(event.type).toBe('agent.propose');
      expect(event.agent).toBe('orchestrator');
      expect(event.timestamp).toBeDefined();
      expect(event.metrics?.latencyMs).toBe(560);
      expect(event.metrics?.tokensUsed).toBe(420);
    });

    it('publishes to routing key agent.orchestrator.propose', async () => {
      const conflictAnalysis = JSON.parse(CONVERGENCE_ANALYSIS_RESPONSE);
      await generator.generateCompromise(TRIP_ID, 3, conflictAnalysis, TRIP_CONTEXT);

      expect(publisher.publish).toHaveBeenCalledWith(
        'agent.orchestrator.propose',
        expect.any(Object),
      );
    });

    it('publishes compromise event to RabbitMQ', async () => {
      const conflictAnalysis = JSON.parse(CONVERGENCE_ANALYSIS_RESPONSE);
      await generator.generateCompromise(TRIP_ID, 3, conflictAnalysis, TRIP_CONTEXT);

      expect(publisher.publish).toHaveBeenCalledOnce();
    });

    it('conflict analysis context and destination are included in Claude prompt', async () => {
      const conflictAnalysis = JSON.parse(CONVERGENCE_ANALYSIS_RESPONSE);
      await generator.generateCompromise(TRIP_ID, 3, conflictAnalysis, TRIP_CONTEXT);

      const callArgs = vi.mocked(anthropic.complete).mock.calls[0];
      const promptText = JSON.stringify(callArgs);
      expect(promptText).toContain('Sintra');
      expect(promptText).toContain('Cascais');
    });
  });

  // -------------------------------------------------------------------------
  describe('End-to-end negotiation flow', () => {
    it('converges within 6 rounds for conflicting 4-agent preferences', async () => {
      // Rounds 1+2: high/mid conflict → continue. Round 3: convergence → generate compromise.
      vi.mocked(anthropic.complete)
        .mockResolvedValueOnce({ content: HIGH_CONFLICT_ANALYSIS_RESPONSE, latencyMs: 420, tokensUsed: 310 })
        .mockResolvedValueOnce({ content: MID_CONFLICT_ANALYSIS_RESPONSE, latencyMs: 390, tokensUsed: 290 })
        .mockResolvedValueOnce({ content: CONVERGENCE_ANALYSIS_RESPONSE, latencyMs: 360, tokensUsed: 260 })
        .mockResolvedValueOnce({ content: COMPROMISE_RESPONSE, latencyMs: 560, tokensUsed: 420 });

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

    it('final compromise budget ≤ €600 for 4 people', async () => {
      vi.mocked(anthropic.complete)
        .mockResolvedValueOnce({ content: CONVERGENCE_ANALYSIS_RESPONSE, latencyMs: 360, tokensUsed: 260 })
        .mockResolvedValueOnce({ content: COMPROMISE_RESPONSE, latencyMs: 560, tokensUsed: 420 });

      const analysis = await analyzer.analyze(TRIP_ID, 3, ALL_PROPOSALS);
      const compromise = await generator.generateCompromise(TRIP_ID, 3, analysis.content, TRIP_CONTEXT);
      const content = compromise.content as CompromiseContent;

      const totalPerPerson = content.itinerary
        .flatMap((day) => day.activities)
        .reduce((sum, act) => sum + act.cost, 0);

      const totalForFourPeople = totalPerPerson * 4;
      expect(totalForFourPeople).toBeLessThanOrEqual(600);
    });

    it('no logistical conflicts — activity times do not overlap within a day', async () => {
      vi.mocked(anthropic.complete)
        .mockResolvedValueOnce({ content: CONVERGENCE_ANALYSIS_RESPONSE, latencyMs: 360, tokensUsed: 260 })
        .mockResolvedValueOnce({ content: COMPROMISE_RESPONSE, latencyMs: 560, tokensUsed: 420 });

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

    it('each activity satisfies at least one of the 4 participants', async () => {
      vi.mocked(anthropic.complete)
        .mockResolvedValueOnce({ content: CONVERGENCE_ANALYSIS_RESPONSE, latencyMs: 360, tokensUsed: 260 })
        .mockResolvedValueOnce({ content: COMPROMISE_RESPONSE, latencyMs: 560, tokensUsed: 420 });

      const analysis = await analyzer.analyze(TRIP_ID, 3, ALL_PROPOSALS);
      const compromise = await generator.generateCompromise(TRIP_ID, 3, analysis.content, TRIP_CONTEXT);
      const content = compromise.content as CompromiseContent;

      for (const day of content.itinerary) {
        for (const activity of day.activities) {
          const satisfied = activity.satisfies.filter((a) => (ALL_AGENTS as readonly string[]).includes(a));
          expect(satisfied.length).toBeGreaterThan(0);
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

      const conflictAnalysis = JSON.parse(CONVERGENCE_ANALYSIS_RESPONSE);
      const event = await generator.generateCompromise(TRIP_ID, 3, conflictAnalysis, TRIP_CONTEXT);

      expect(event.content).toEqual({ raw: NON_JSON_RESPONSE });
    });

    it('ConflictAnalyzer with empty proposals array still calls Claude', async () => {
      vi.mocked(anthropic.complete).mockResolvedValue({
        content: HIGH_CONFLICT_ANALYSIS_RESPONSE,
        latencyMs: 250,
        tokensUsed: 180,
      });

      const event = await analyzer.analyze(TRIP_ID, 1, []);

      expect(anthropic.complete).toHaveBeenCalledOnce();
      expect(event.agent).toBe('orchestrator');
    });

    it('negotiation loop stops at round 6 even if conflicts persist', async () => {
      // All 6 rounds return high conflict — loop must not exceed MAX_ROUNDS
      vi.mocked(anthropic.complete).mockResolvedValue({
        content: HIGH_CONFLICT_ANALYSIS_RESPONSE, // overallConflictScore: 3.8
        latencyMs: 420,
        tokensUsed: 310,
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

      const conflictAnalysis = JSON.parse(CONVERGENCE_ANALYSIS_RESPONSE);
      await expect(
        generator.generateCompromise(TRIP_ID, 3, conflictAnalysis, TRIP_CONTEXT),
      ).rejects.toThrow();
    });
  });
});

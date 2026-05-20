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

// WeatherAnalyzer imported via relative path so its @/agents/BaseLogisticsAgent resolves
// via the vitest.config.ts alias to logistics-agent/src. Its @/services/* imports resolve
// to orchestrator-agent/src (generic @/ alias), which are all covered by the vi.mock stubs above.
import { WeatherAnalyzer } from '../../services/logistics-agent/src/agents/WeatherAnalyzer';

import {
  TRIP_ID,
  TRIP_CONTEXT,
  RAINY_FORECASTS,
  MOCK_TIMING,
  ALICE_PROPOSAL,
  BOB_PROPOSAL,
  CARLOS_PROPOSAL,
  DIANA_PROPOSAL,
  WEATHER_ANALYSIS_RESPONSE,
  WEATHER_CONFLICT_ANALYSIS_RESPONSE,
  WEATHER_CONVERGENCE_ANALYSIS_RESPONSE,
  INDOOR_COMPROMISE_RESPONSE,
  NON_JSON_RESPONSE,
} from './helpers/rainy-forecast-fixtures';

interface DayAssessment {
  day: number;
  location: string;
  weatherRisk: string;
  affectedActivities: Array<{ activity: string; risk: string; reason: string }>;
  indoorAlternatives: Array<{ replaces: string; alternative: string; cost: number; currency: string }>;
}

interface WeatherAnalysisContent {
  overallRisk: string;
  dayAssessments: DayAssessment[];
  recommendations: string[];
  summary: string;
}

interface ConflictAnalysisContent {
  conflicts: Array<{ agents: string[]; topic: string; description: string; severity: number }>;
  consensusAreas: Array<{ topic: string; agents: string[] }>;
  overallConflictScore: number;
  roundSummary: string;
}

interface IndoorActivity {
  time: string;
  activity: string;
  cost: number;
  currency: string;
  satisfies: string[];
  description: string;
}

interface CompromiseContent {
  itinerary: Array<{ day: number; destination: string; activities: IndoorActivity[] }>;
  satisfactionEstimates: Record<string, number>;
  unresolvedConflicts: unknown[];
  compromiseRationale: string;
}

const ALL_AGENTS = ['alice', 'bob', 'carlos', 'diana'] as const;
const ALL_PROPOSALS = [ALICE_PROPOSAL, BOB_PROPOSAL, CARLOS_PROPOSAL, DIANA_PROPOSAL];

// Keywords that identify outdoor/weather-exposed activities
const OUTDOOR_KEYWORDS = ['trail', 'hike', 'surf', 'cycling', 'kayak', 'beach', 'cliff', 'outdoor', 'promenade', 'coastal walk'];

describe('Scenario 004 — Alice+Bob+Carlos+Diana, Sintra+Cascais, 2 days, 80% rain forecast', () => {
  let anthropic: AnthropicService;
  let publisher: RabbitMQPublisher;
  let redis: RedisService;
  let storage: ProposalStorageService;
  let analyzer: ConflictAnalyzer;
  let generator: CompromiseGenerator;
  let weatherAnalyzer: WeatherAnalyzer;

  beforeEach(() => {
    vi.clearAllMocks();
    anthropic = new AnthropicService();
    publisher = new RabbitMQPublisher();
    redis = new RedisService();
    storage = new ProposalStorageService();
    analyzer = new ConflictAnalyzer(anthropic, publisher, redis, storage);
    generator = new CompromiseGenerator(anthropic, publisher, redis, storage);
    weatherAnalyzer = new WeatherAnalyzer(
      anthropic as never,
      publisher as never,
      redis as never,
      storage as never,
    );

    vi.mocked(redis.get).mockResolvedValue(null);
    vi.mocked(redis.set).mockResolvedValue(undefined);
    vi.mocked(storage.save).mockResolvedValue(undefined);
    vi.mocked(publisher.publish).mockResolvedValue(undefined);
  });

  // ---------------------------------------------------------------------------
  describe('WeatherAnalyzer — flags outdoor activities in heavy rain', () => {
    beforeEach(() => {
      vi.mocked(anthropic.complete).mockResolvedValue({
        content: WEATHER_ANALYSIS_RESPONSE,
        latencyMs: 520,
        tokensUsed: 410,
      });
    });

    it('overallRisk === "high" when 80% rain forecast', async () => {
      const event = await weatherAnalyzer.analyze(
        TRIP_ID, 1, ALL_PROPOSALS, RAINY_FORECASTS, MOCK_TIMING,
      );
      const content = event.content as WeatherAnalysisContent;

      expect(content.overallRisk).toBe('high');
    });

    it('both days have affectedActivities (outdoor activities flagged)', async () => {
      const event = await weatherAnalyzer.analyze(
        TRIP_ID, 1, ALL_PROPOSALS, RAINY_FORECASTS, MOCK_TIMING,
      );
      const content = event.content as WeatherAnalysisContent;

      for (const day of content.dayAssessments) {
        expect(day.affectedActivities.length).toBeGreaterThan(0);
      }
    });

    it('every affectedActivity has weatherRisk === "high"', async () => {
      const event = await weatherAnalyzer.analyze(
        TRIP_ID, 1, ALL_PROPOSALS, RAINY_FORECASTS, MOCK_TIMING,
      );
      const content = event.content as WeatherAnalysisContent;

      for (const day of content.dayAssessments) {
        for (const act of day.affectedActivities) {
          expect(act.risk).toBe('high');
        }
      }
    });

    it('indoorAlternatives provided for every flagged activity', async () => {
      const event = await weatherAnalyzer.analyze(
        TRIP_ID, 1, ALL_PROPOSALS, RAINY_FORECASTS, MOCK_TIMING,
      );
      const content = event.content as WeatherAnalysisContent;

      for (const day of content.dayAssessments) {
        expect(day.indoorAlternatives.length).toBeGreaterThanOrEqual(
          day.affectedActivities.length,
        );
      }
    });

    it('produces a valid AgentEvent with agent === "logistics"', async () => {
      const event = await weatherAnalyzer.analyze(
        TRIP_ID, 1, ALL_PROPOSALS, RAINY_FORECASTS, MOCK_TIMING,
      );

      expect(event.tripId).toBe(TRIP_ID);
      expect(event.round).toBe(1);
      expect(event.agent).toBe('logistics');
      expect(event.type).toBe('agent.propose');
      expect(event.timestamp).toBeDefined();
      expect(event.metrics?.latencyMs).toBe(520);
      expect(event.metrics?.tokensUsed).toBe(410);
    });

    it('publishes to routing key agent.logistics.propose', async () => {
      await weatherAnalyzer.analyze(TRIP_ID, 1, ALL_PROPOSALS, RAINY_FORECASTS, MOCK_TIMING);

      expect(publisher.publish).toHaveBeenCalledWith('agent.logistics.propose', expect.any(Object));
    });

    it('cache hit: returns cached event without calling Claude', async () => {
      const cachedEvent: AgentEvent = {
        tripId: TRIP_ID,
        type: 'agent.propose',
        agent: 'logistics',
        round: 1,
        timestamp: new Date().toISOString(),
        content: { overallRisk: 'high' },
      };
      vi.mocked(redis.get).mockResolvedValue(cachedEvent);

      const event = await weatherAnalyzer.analyze(
        TRIP_ID, 1, ALL_PROPOSALS, RAINY_FORECASTS, MOCK_TIMING,
      );

      expect(anthropic.complete).not.toHaveBeenCalled();
      expect(storage.save).not.toHaveBeenCalled();
      expect(event).toEqual(cachedEvent);
    });

    it('uses correct cache key per round', async () => {
      await weatherAnalyzer.analyze(TRIP_ID, 2, ALL_PROPOSALS, RAINY_FORECASTS, MOCK_TIMING);

      expect(redis.get).toHaveBeenCalledWith(
        `logistics:${TRIP_ID}:weather-analyzer:2:propose`,
      );
    });

    it('includes weather forecast data in Claude prompt', async () => {
      await weatherAnalyzer.analyze(TRIP_ID, 1, ALL_PROPOSALS, RAINY_FORECASTS, MOCK_TIMING);

      const callArg = vi.mocked(anthropic.complete).mock.calls[0];
      const callStr = JSON.stringify(callArg);
      expect(callStr).toContain('Sintra');
      expect(callStr).toContain('Rain');
      expect(callStr).toContain('heavy rain all day');
    });

    it('wraps non-JSON Claude response as { raw: string }', async () => {
      vi.mocked(anthropic.complete).mockResolvedValue({
        content: NON_JSON_RESPONSE,
        latencyMs: 200,
        tokensUsed: 30,
      });

      const event = await weatherAnalyzer.analyze(
        TRIP_ID, 1, ALL_PROPOSALS, RAINY_FORECASTS, MOCK_TIMING,
      );

      expect(event.content).toEqual({ raw: NON_JSON_RESPONSE });
    });

    it('propagates Claude service errors', async () => {
      vi.mocked(anthropic.complete).mockRejectedValue(new Error('Anthropic API unavailable'));

      await expect(
        weatherAnalyzer.analyze(TRIP_ID, 1, ALL_PROPOSALS, RAINY_FORECASTS, MOCK_TIMING),
      ).rejects.toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  describe('ConflictAnalyzer — weather-driven conflicts in 4-agent proposals', () => {
    beforeEach(() => {
      vi.mocked(anthropic.complete).mockResolvedValue({
        content: WEATHER_CONFLICT_ANALYSIS_RESPONSE,
        latencyMs: 460,
        tokensUsed: 340,
      });
    });

    it('returns overallConflictScore > 2.0 due to weather constraint', async () => {
      const event = await analyzer.analyze(TRIP_ID, 1, ALL_PROPOSALS);
      const content = event.content as ConflictAnalysisContent;

      expect(content.overallConflictScore).toBeGreaterThan(2.0);
    });

    it('conflicts include weather_constraint topic', async () => {
      const event = await analyzer.analyze(TRIP_ID, 1, ALL_PROPOSALS);
      const content = event.content as ConflictAnalysisContent;

      const topics = content.conflicts.map((c) => c.topic);
      expect(topics).toContain('weather_constraint');
    });

    it('weather_constraint conflict has severity === 5', async () => {
      const event = await analyzer.analyze(TRIP_ID, 1, ALL_PROPOSALS);
      const content = event.content as ConflictAnalysisContent;

      const weatherConflict = content.conflicts.find((c) => c.topic === 'weather_constraint');
      expect(weatherConflict).toBeDefined();
      expect(weatherConflict?.severity).toBe(5);
    });

    it('conflicts include outdoor_activity topic with severity ≥ 4', async () => {
      const event = await analyzer.analyze(TRIP_ID, 1, ALL_PROPOSALS);
      const content = event.content as ConflictAnalysisContent;

      const outdoorConflict = content.conflicts.find((c) => c.topic === 'outdoor_activity');
      expect(outdoorConflict).toBeDefined();
      expect(outdoorConflict?.severity).toBeGreaterThanOrEqual(4);
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
      expect(event.metrics?.latencyMs).toBe(460);
      expect(event.metrics?.tokensUsed).toBe(340);
    });

    it('publishes to routing key agent.orchestrator.score', async () => {
      await analyzer.analyze(TRIP_ID, 1, ALL_PROPOSALS);

      expect(publisher.publish).toHaveBeenCalledWith('agent.orchestrator.score', expect.any(Object));
    });
  });

  // ---------------------------------------------------------------------------
  describe('CompromiseGenerator — indoor-only itinerary after weather constraint', () => {
    beforeEach(() => {
      vi.mocked(anthropic.complete).mockResolvedValue({
        content: INDOOR_COMPROMISE_RESPONSE,
        latencyMs: 610,
        tokensUsed: 450,
      });
    });

    it('no outdoor activities remain in final itinerary', async () => {
      const conflictAnalysis = JSON.parse(WEATHER_CONVERGENCE_ANALYSIS_RESPONSE);
      const event = await generator.generateCompromise(TRIP_ID, 2, conflictAnalysis, TRIP_CONTEXT);
      const content = event.content as CompromiseContent;

      const allActivityNames = content.itinerary
        .flatMap((day) => day.activities)
        .map((act) => act.activity.toLowerCase());

      for (const name of allActivityNames) {
        for (const keyword of OUTDOOR_KEYWORDS) {
          expect(name).not.toContain(keyword);
        }
      }
    });

    it('satisfactionEstimates.alice ≥ 0.60', async () => {
      const conflictAnalysis = JSON.parse(WEATHER_CONVERGENCE_ANALYSIS_RESPONSE);
      const event = await generator.generateCompromise(TRIP_ID, 2, conflictAnalysis, TRIP_CONTEXT);
      const content = event.content as CompromiseContent;

      expect(content.satisfactionEstimates['alice']).toBeGreaterThanOrEqual(0.60);
    });

    it('satisfactionEstimates.bob ≥ 0.60', async () => {
      const conflictAnalysis = JSON.parse(WEATHER_CONVERGENCE_ANALYSIS_RESPONSE);
      const event = await generator.generateCompromise(TRIP_ID, 2, conflictAnalysis, TRIP_CONTEXT);
      const content = event.content as CompromiseContent;

      expect(content.satisfactionEstimates['bob']).toBeGreaterThanOrEqual(0.60);
    });

    it('satisfactionEstimates.carlos ≥ 0.60', async () => {
      const conflictAnalysis = JSON.parse(WEATHER_CONVERGENCE_ANALYSIS_RESPONSE);
      const event = await generator.generateCompromise(TRIP_ID, 2, conflictAnalysis, TRIP_CONTEXT);
      const content = event.content as CompromiseContent;

      expect(content.satisfactionEstimates['carlos']).toBeGreaterThanOrEqual(0.60);
    });

    it('satisfactionEstimates.diana ≥ 0.60', async () => {
      const conflictAnalysis = JSON.parse(WEATHER_CONVERGENCE_ANALYSIS_RESPONSE);
      const event = await generator.generateCompromise(TRIP_ID, 2, conflictAnalysis, TRIP_CONTEXT);
      const content = event.content as CompromiseContent;

      expect(content.satisfactionEstimates['diana']).toBeGreaterThanOrEqual(0.60);
    });

    it('itinerary covers Sintra (day 1) and Cascais (day 2)', async () => {
      const conflictAnalysis = JSON.parse(WEATHER_CONVERGENCE_ANALYSIS_RESPONSE);
      const event = await generator.generateCompromise(TRIP_ID, 2, conflictAnalysis, TRIP_CONTEXT);
      const content = event.content as CompromiseContent;

      const days = content.itinerary.map((d) => d.day);
      expect(days).toContain(1);
      expect(days).toContain(2);

      const allText = JSON.stringify(content.itinerary);
      expect(allText).toMatch(/[Ss]intra/);
      expect(allText).toMatch(/[Cc]ascais/);
    });

    it('unresolvedConflicts is empty after weather convergence', async () => {
      const conflictAnalysis = JSON.parse(WEATHER_CONVERGENCE_ANALYSIS_RESPONSE);
      const event = await generator.generateCompromise(TRIP_ID, 2, conflictAnalysis, TRIP_CONTEXT);
      const content = event.content as CompromiseContent;

      expect(content.unresolvedConflicts).toHaveLength(0);
    });

    it('each activity satisfies at least one of the 4 participants', async () => {
      const conflictAnalysis = JSON.parse(WEATHER_CONVERGENCE_ANALYSIS_RESPONSE);
      const event = await generator.generateCompromise(TRIP_ID, 2, conflictAnalysis, TRIP_CONTEXT);
      const content = event.content as CompromiseContent;

      for (const day of content.itinerary) {
        for (const activity of day.activities) {
          const satisfied = activity.satisfies.filter((a) =>
            (ALL_AGENTS as readonly string[]).includes(a),
          );
          expect(satisfied.length).toBeGreaterThan(0);
        }
      }
    });

    it('produces a valid AgentEvent with required fields', async () => {
      const conflictAnalysis = JSON.parse(WEATHER_CONVERGENCE_ANALYSIS_RESPONSE);
      const event = await generator.generateCompromise(TRIP_ID, 2, conflictAnalysis, TRIP_CONTEXT);

      expect(event.tripId).toBe(TRIP_ID);
      expect(event.round).toBe(2);
      expect(event.type).toBe('agent.propose');
      expect(event.agent).toBe('orchestrator');
      expect(event.timestamp).toBeDefined();
      expect(event.metrics?.latencyMs).toBe(610);
      expect(event.metrics?.tokensUsed).toBe(450);
    });
  });

  // ---------------------------------------------------------------------------
  describe('End-to-end — logistics flags outdoor risk, orchestrator produces indoor plan', () => {
    it('WeatherAnalyzer reports overallRisk "high" for both days', async () => {
      vi.mocked(anthropic.complete).mockResolvedValue({
        content: WEATHER_ANALYSIS_RESPONSE,
        latencyMs: 520,
        tokensUsed: 410,
      });

      const event = await weatherAnalyzer.analyze(
        TRIP_ID, 1, ALL_PROPOSALS, RAINY_FORECASTS, MOCK_TIMING,
      );
      const content = event.content as WeatherAnalysisContent;

      expect(content.overallRisk).toBe('high');
      expect(content.dayAssessments).toHaveLength(2);
      for (const day of content.dayAssessments) {
        expect(day.weatherRisk).toBe('high');
      }
    });

    it('ConflictAnalyzer converges within 4 rounds under weather constraint', async () => {
      vi.mocked(anthropic.complete)
        .mockResolvedValueOnce({ content: WEATHER_CONFLICT_ANALYSIS_RESPONSE, latencyMs: 460, tokensUsed: 340 })
        .mockResolvedValueOnce({ content: WEATHER_CONVERGENCE_ANALYSIS_RESPONSE, latencyMs: 380, tokensUsed: 280 })
        .mockResolvedValueOnce({ content: INDOOR_COMPROMISE_RESPONSE, latencyMs: 610, tokensUsed: 450 });

      const MAX_ROUNDS = 4;
      let roundsCompleted = 0;
      let compromise: AgentEvent | null = null;

      for (let round = 1; round <= MAX_ROUNDS; round++) {
        const analysis = await analyzer.analyze(TRIP_ID, round, ALL_PROPOSALS);
        const content = analysis.content as ConflictAnalysisContent;
        roundsCompleted = round;

        if (content.overallConflictScore < 1.0) {
          compromise = await generator.generateCompromise(TRIP_ID, round, analysis.content, TRIP_CONTEXT);
          break;
        }
      }

      expect(compromise).not.toBeNull();
      expect(roundsCompleted).toBeLessThanOrEqual(MAX_ROUNDS);
    });

    it('final compromise contains no outdoor activities', async () => {
      vi.mocked(anthropic.complete)
        .mockResolvedValueOnce({ content: WEATHER_CONVERGENCE_ANALYSIS_RESPONSE, latencyMs: 380, tokensUsed: 280 })
        .mockResolvedValueOnce({ content: INDOOR_COMPROMISE_RESPONSE, latencyMs: 610, tokensUsed: 450 });

      const analysis = await analyzer.analyze(TRIP_ID, 2, ALL_PROPOSALS);
      const compromise = await generator.generateCompromise(TRIP_ID, 2, analysis.content, TRIP_CONTEXT);
      const content = compromise.content as CompromiseContent;

      const allActivityNames = content.itinerary
        .flatMap((day) => day.activities)
        .map((act) => act.activity.toLowerCase());

      for (const name of allActivityNames) {
        for (const keyword of OUTDOOR_KEYWORDS) {
          expect(name).not.toContain(keyword);
        }
      }
    });

    it('all 4 traveller satisfactionEstimates ≥ 0.60 in indoor compromise', async () => {
      vi.mocked(anthropic.complete)
        .mockResolvedValueOnce({ content: WEATHER_CONVERGENCE_ANALYSIS_RESPONSE, latencyMs: 380, tokensUsed: 280 })
        .mockResolvedValueOnce({ content: INDOOR_COMPROMISE_RESPONSE, latencyMs: 610, tokensUsed: 450 });

      const analysis = await analyzer.analyze(TRIP_ID, 2, ALL_PROPOSALS);
      const compromise = await generator.generateCompromise(TRIP_ID, 2, analysis.content, TRIP_CONTEXT);
      const content = compromise.content as CompromiseContent;

      for (const agent of ALL_AGENTS) {
        expect(content.satisfactionEstimates[agent]).toBeGreaterThanOrEqual(0.60);
      }
    });
  });

  // ---------------------------------------------------------------------------
  describe('Error scenarios', () => {
    it('WeatherAnalyzer wraps non-JSON Claude response as { raw: string }', async () => {
      vi.mocked(anthropic.complete).mockResolvedValue({
        content: NON_JSON_RESPONSE,
        latencyMs: 200,
        tokensUsed: 30,
      });

      const event = await weatherAnalyzer.analyze(
        TRIP_ID, 1, ALL_PROPOSALS, RAINY_FORECASTS, MOCK_TIMING,
      );

      expect(event.content).toEqual({ raw: NON_JSON_RESPONSE });
    });

    it('WeatherAnalyzer propagates Claude service errors', async () => {
      vi.mocked(anthropic.complete).mockRejectedValue(new Error('Anthropic API unavailable'));

      await expect(
        weatherAnalyzer.analyze(TRIP_ID, 1, ALL_PROPOSALS, RAINY_FORECASTS, MOCK_TIMING),
      ).rejects.toThrow();
    });

    it('ConflictAnalyzer wraps non-JSON Claude response as { raw: string }', async () => {
      vi.mocked(anthropic.complete).mockResolvedValue({
        content: NON_JSON_RESPONSE,
        latencyMs: 200,
        tokensUsed: 30,
      });

      const event = await analyzer.analyze(TRIP_ID, 1, ALL_PROPOSALS);

      expect(event.content).toEqual({ raw: NON_JSON_RESPONSE });
    });

    it('ConflictAnalyzer propagates Claude service errors', async () => {
      vi.mocked(anthropic.complete).mockRejectedValue(new Error('Anthropic API unavailable'));

      await expect(analyzer.analyze(TRIP_ID, 1, ALL_PROPOSALS)).rejects.toThrow();
    });

    it('negotiation loop stops at round 6 even if weather conflicts persist', async () => {
      vi.mocked(anthropic.complete).mockResolvedValue({
        content: WEATHER_CONFLICT_ANALYSIS_RESPONSE, // overallConflictScore: 3.2
        latencyMs: 460,
        tokensUsed: 340,
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
  });
});

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

// Finance-agent classes imported via relative path.
// Their internal @/ imports resolve to orchestrator-agent/src in this test context,
// so the vi.mock('@/services/...') stubs above apply to them as well.
import { CostCalculator } from '../../services/finance-agent/src/agents/CostCalculator';
import { BudgetValidator } from '../../services/finance-agent/src/agents/BudgetValidator';
import { AlternativeFinder } from '../../services/finance-agent/src/agents/AlternativeFinder';

import {
  TRIP_ID,
  TRIP_CONTEXT,
  OVER_BUDGET_ITINERARY,
  WITHIN_BUDGET_ITINERARY,
  ALICE_PROPOSAL,
  BOB_PROPOSAL,
  CARLOS_PROPOSAL,
  DIANA_PROPOSAL,
  BUDGET_CONFLICT_ANALYSIS_RESPONSE,
  BUDGET_CONVERGENCE_ANALYSIS_RESPONSE,
  BUDGET_CONSTRAINED_COMPROMISE_RESPONSE,
  BUDGET_ALTERNATIVES_RESPONSE,
  NON_JSON_RESPONSE,
} from './helpers/tight-budget-fixtures';

interface ConflictAnalysisContent {
  conflicts: Array<{ agents: string[]; topic: string; description: string; severity: number }>;
  consensusAreas: Array<{ topic: string; agents: string[] }>;
  overallConflictScore: number;
  roundSummary: string;
}

interface TightBudgetActivity {
  time: string;
  activity: string;
  cost: number;
  currency: string;
  satisfies: string[];
  description: string;
}

interface CompromiseContent {
  itinerary: Array<{ day: number; destination: string; activities: TightBudgetActivity[] }>;
  satisfactionEstimates: Record<string, number>;
  unresolvedConflicts: unknown[];
  compromiseRationale: string;
}

const ALL_AGENTS = ['alice', 'bob', 'carlos', 'diana'] as const;
const ALL_PROPOSALS = [ALICE_PROPOSAL, BOB_PROPOSAL, CARLOS_PROPOSAL, DIANA_PROPOSAL];
const BUDGET_TOTAL = 300;
const BUDGET_CURRENCY = 'EUR';

describe('Scenario 003 — Alice+Bob+Carlos+Diana, Sintra+Cascais, 2 days, €300 tight budget', () => {
  let anthropic: AnthropicService;
  let publisher: RabbitMQPublisher;
  let redis: RedisService;
  let storage: ProposalStorageService;
  let analyzer: ConflictAnalyzer;
  let generator: CompromiseGenerator;
  let alternativeFinder: AlternativeFinder;

  beforeEach(() => {
    vi.clearAllMocks();
    anthropic = new AnthropicService();
    publisher = new RabbitMQPublisher();
    redis = new RedisService();
    storage = new ProposalStorageService();
    analyzer = new ConflictAnalyzer(anthropic, publisher, redis, storage);
    generator = new CompromiseGenerator(anthropic, publisher, redis, storage);
    alternativeFinder = new AlternativeFinder(
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
  describe('CostCalculator — initial proposals exceed €300 budget', () => {
    let calculator: CostCalculator;

    beforeEach(() => {
      calculator = new CostCalculator();
    });

    it('grandTotal > 300 for OVER_BUDGET_ITINERARY', () => {
      const result = calculator.calculate(OVER_BUDGET_ITINERARY, BUDGET_CURRENCY);

      expect(result.grandTotal).toBeGreaterThan(300);
    });

    it('currency is EUR', () => {
      const result = calculator.calculate(OVER_BUDGET_ITINERARY, BUDGET_CURRENCY);

      expect(result.currency).toBe('EUR');
    });

    it('byCategory totals sum to grandTotal', () => {
      const result = calculator.calculate(OVER_BUDGET_ITINERARY, BUDGET_CURRENCY);
      const { activities, meals, transport } = result.byCategory;

      expect(activities + meals + transport).toBe(result.grandTotal);
    });

    it('grandTotal ≤ 300 for WITHIN_BUDGET_ITINERARY', () => {
      const result = calculator.calculate(WITHIN_BUDGET_ITINERARY, BUDGET_CURRENCY);

      expect(result.grandTotal).toBeLessThanOrEqual(300);
    });

    it('returns original itinerary items in breakdown', () => {
      const result = calculator.calculate(OVER_BUDGET_ITINERARY, BUDGET_CURRENCY);

      expect(result.items).toHaveLength(OVER_BUDGET_ITINERARY.length);
    });
  });

  // ---------------------------------------------------------------------------
  describe('BudgetValidator — flags over_budget for tight €300 cap', () => {
    let calculator: CostCalculator;
    let validator: BudgetValidator;

    beforeEach(() => {
      calculator = new CostCalculator();
      validator = new BudgetValidator();
    });

    it('status === "over_budget" when grandTotal exceeds budgetTotal', () => {
      const breakdown = calculator.calculate(OVER_BUDGET_ITINERARY, BUDGET_CURRENCY);
      const result = validator.validate(breakdown, BUDGET_TOTAL, BUDGET_CURRENCY);

      expect(result.status).toBe('over_budget');
    });

    it('overAmount > 0 and equals grandTotal minus budgetTotal', () => {
      const breakdown = calculator.calculate(OVER_BUDGET_ITINERARY, BUDGET_CURRENCY);
      const result = validator.validate(breakdown, BUDGET_TOTAL, BUDGET_CURRENCY);

      expect(result.overAmount).toBeGreaterThan(0);
      expect(result.overAmount).toBe(breakdown.grandTotal - BUDGET_TOTAL);
    });

    it('percentageUsed > 100 for over-budget proposals', () => {
      const breakdown = calculator.calculate(OVER_BUDGET_ITINERARY, BUDGET_CURRENCY);
      const result = validator.validate(breakdown, BUDGET_TOTAL, BUDGET_CURRENCY);

      expect(result.percentageUsed).toBeGreaterThan(100);
    });

    it('status === "within_budget" for budget-constrained itinerary', () => {
      const breakdown = calculator.calculate(WITHIN_BUDGET_ITINERARY, BUDGET_CURRENCY);
      const result = validator.validate(breakdown, BUDGET_TOTAL, BUDGET_CURRENCY);

      expect(result.status).toBe('within_budget');
    });

    it('remaining ≥ 0 for within-budget itinerary', () => {
      const breakdown = calculator.calculate(WITHIN_BUDGET_ITINERARY, BUDGET_CURRENCY);
      const result = validator.validate(breakdown, BUDGET_TOTAL, BUDGET_CURRENCY);

      expect(result.remaining).toBeGreaterThanOrEqual(0);
    });

    it('budgetTotal and currency are echoed on result', () => {
      const breakdown = calculator.calculate(OVER_BUDGET_ITINERARY, BUDGET_CURRENCY);
      const result = validator.validate(breakdown, BUDGET_TOTAL, BUDGET_CURRENCY);

      expect(result.budgetTotal).toBe(BUDGET_TOTAL);
      expect(result.currency).toBe(BUDGET_CURRENCY);
    });
  });

  // ---------------------------------------------------------------------------
  describe('AlternativeFinder — provides alternatives when over budget', () => {
    let calculator: CostCalculator;
    let validator: BudgetValidator;

    beforeEach(() => {
      calculator = new CostCalculator();
      validator = new BudgetValidator();

      vi.mocked(anthropic.complete).mockResolvedValue({
        content: BUDGET_ALTERNATIVES_RESPONSE,
        latencyMs: 380,
        tokensUsed: 290,
      });
    });

    it('calls Claude when validation.status === "over_budget"', async () => {
      const breakdown = calculator.calculate(OVER_BUDGET_ITINERARY, BUDGET_CURRENCY);
      const validation = validator.validate(breakdown, BUDGET_TOTAL, BUDGET_CURRENCY);

      await alternativeFinder.findAlternatives(TRIP_ID, 1, OVER_BUDGET_ITINERARY, breakdown, validation, TRIP_CONTEXT);

      expect(anthropic.complete).toHaveBeenCalledOnce();
    });

    it('returned event has costBreakdown, budgetValidation, and alternatives', async () => {
      const breakdown = calculator.calculate(OVER_BUDGET_ITINERARY, BUDGET_CURRENCY);
      const validation = validator.validate(breakdown, BUDGET_TOTAL, BUDGET_CURRENCY);

      const event = await alternativeFinder.findAlternatives(
        TRIP_ID, 1, OVER_BUDGET_ITINERARY, breakdown, validation, TRIP_CONTEXT,
      );
      const content = event.content as Record<string, unknown>;

      expect(content).toHaveProperty('costBreakdown');
      expect(content).toHaveProperty('budgetValidation');
      expect(content).toHaveProperty('alternatives');
    });

    it('does NOT call Claude when validation.status === "within_budget"', async () => {
      const breakdown = calculator.calculate(WITHIN_BUDGET_ITINERARY, BUDGET_CURRENCY);
      const validation = validator.validate(breakdown, BUDGET_TOTAL, BUDGET_CURRENCY);

      await alternativeFinder.findAlternatives(
        TRIP_ID, 1, WITHIN_BUDGET_ITINERARY, breakdown, validation, TRIP_CONTEXT,
      );

      expect(anthropic.complete).not.toHaveBeenCalled();
    });

    it('publishes to routing key agent.finance.propose', async () => {
      const breakdown = calculator.calculate(OVER_BUDGET_ITINERARY, BUDGET_CURRENCY);
      const validation = validator.validate(breakdown, BUDGET_TOTAL, BUDGET_CURRENCY);

      await alternativeFinder.findAlternatives(TRIP_ID, 1, OVER_BUDGET_ITINERARY, breakdown, validation, TRIP_CONTEXT);

      expect(publisher.publish).toHaveBeenCalledWith('agent.finance.propose', expect.any(Object));
    });

    it('saves to storage once', async () => {
      const breakdown = calculator.calculate(OVER_BUDGET_ITINERARY, BUDGET_CURRENCY);
      const validation = validator.validate(breakdown, BUDGET_TOTAL, BUDGET_CURRENCY);

      await alternativeFinder.findAlternatives(TRIP_ID, 1, OVER_BUDGET_ITINERARY, breakdown, validation, TRIP_CONTEXT);

      expect(storage.save).toHaveBeenCalledOnce();
    });

    it('wraps non-JSON Claude response as { raw: string }', async () => {
      vi.mocked(anthropic.complete).mockResolvedValue({
        content: NON_JSON_RESPONSE,
        latencyMs: 200,
        tokensUsed: 30,
      });

      const breakdown = calculator.calculate(OVER_BUDGET_ITINERARY, BUDGET_CURRENCY);
      const validation = validator.validate(breakdown, BUDGET_TOTAL, BUDGET_CURRENCY);

      const event = await alternativeFinder.findAlternatives(
        TRIP_ID, 1, OVER_BUDGET_ITINERARY, breakdown, validation, TRIP_CONTEXT,
      );
      const content = event.content as Record<string, unknown>;

      expect(content.alternatives).toEqual({ raw: NON_JSON_RESPONSE });
    });

    it('produces a valid AgentEvent with agent === "finance"', async () => {
      const breakdown = calculator.calculate(OVER_BUDGET_ITINERARY, BUDGET_CURRENCY);
      const validation = validator.validate(breakdown, BUDGET_TOTAL, BUDGET_CURRENCY);

      const event = await alternativeFinder.findAlternatives(
        TRIP_ID, 1, OVER_BUDGET_ITINERARY, breakdown, validation, TRIP_CONTEXT,
      );

      expect(event.tripId).toBe(TRIP_ID);
      expect(event.round).toBe(1);
      expect(event.agent).toBe('finance');
      expect(event.type).toBe('agent.propose');
      expect(event.timestamp).toBeDefined();
      expect(event.metrics?.latencyMs).toBe(380);
      expect(event.metrics?.tokensUsed).toBe(290);
    });
  });

  // ---------------------------------------------------------------------------
  describe('ConflictAnalyzer — budget conflicts in 4-agent proposals', () => {
    beforeEach(() => {
      vi.mocked(anthropic.complete).mockResolvedValue({
        content: BUDGET_CONFLICT_ANALYSIS_RESPONSE,
        latencyMs: 440,
        tokensUsed: 320,
      });
    });

    it('returns overallConflictScore > 2.0 for tight-budget 4-agent proposals', async () => {
      const event = await analyzer.analyze(TRIP_ID, 1, ALL_PROPOSALS);
      const content = event.content as ConflictAnalysisContent;

      expect(content.overallConflictScore).toBeGreaterThan(2.0);
    });

    it('conflicts include budget_allocation topic', async () => {
      const event = await analyzer.analyze(TRIP_ID, 1, ALL_PROPOSALS);
      const content = event.content as ConflictAnalysisContent;

      const topics = content.conflicts.map((c) => c.topic);
      expect(topics).toContain('budget_allocation');
    });

    it('budget_allocation conflict has severity ≥ 4', async () => {
      const event = await analyzer.analyze(TRIP_ID, 1, ALL_PROPOSALS);
      const content = event.content as ConflictAnalysisContent;

      const budgetConflict = content.conflicts.find((c) => c.topic === 'budget_allocation');
      expect(budgetConflict).toBeDefined();
      expect(budgetConflict?.severity).toBeGreaterThanOrEqual(4);
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
      expect(event.metrics?.latencyMs).toBe(440);
      expect(event.metrics?.tokensUsed).toBe(320);
    });

    it('publishes to routing key agent.orchestrator.score', async () => {
      await analyzer.analyze(TRIP_ID, 1, ALL_PROPOSALS);

      expect(publisher.publish).toHaveBeenCalledWith('agent.orchestrator.score', expect.any(Object));
    });
  });

  // ---------------------------------------------------------------------------
  describe('CompromiseGenerator — budget-constrained compromise fits within €300', () => {
    beforeEach(() => {
      vi.mocked(anthropic.complete).mockResolvedValue({
        content: BUDGET_CONSTRAINED_COMPROMISE_RESPONSE,
        latencyMs: 580,
        tokensUsed: 430,
      });
    });

    it('totalForFourPeople ≤ €300', async () => {
      const conflictAnalysis = JSON.parse(BUDGET_CONVERGENCE_ANALYSIS_RESPONSE);
      const event = await generator.generateCompromise(TRIP_ID, 3, conflictAnalysis, TRIP_CONTEXT);
      const content = event.content as CompromiseContent;

      const totalPerPerson = content.itinerary
        .flatMap((day) => day.activities)
        .reduce((sum, act) => sum + act.cost, 0);

      expect(totalPerPerson * 4).toBeLessThanOrEqual(300);
    });

    it('satisfactionEstimates.alice ≥ 0.60', async () => {
      const conflictAnalysis = JSON.parse(BUDGET_CONVERGENCE_ANALYSIS_RESPONSE);
      const event = await generator.generateCompromise(TRIP_ID, 3, conflictAnalysis, TRIP_CONTEXT);
      const content = event.content as CompromiseContent;

      expect(content.satisfactionEstimates['alice']).toBeGreaterThanOrEqual(0.60);
    });

    it('satisfactionEstimates.bob ≥ 0.60', async () => {
      const conflictAnalysis = JSON.parse(BUDGET_CONVERGENCE_ANALYSIS_RESPONSE);
      const event = await generator.generateCompromise(TRIP_ID, 3, conflictAnalysis, TRIP_CONTEXT);
      const content = event.content as CompromiseContent;

      expect(content.satisfactionEstimates['bob']).toBeGreaterThanOrEqual(0.60);
    });

    it('satisfactionEstimates.carlos ≥ 0.60', async () => {
      const conflictAnalysis = JSON.parse(BUDGET_CONVERGENCE_ANALYSIS_RESPONSE);
      const event = await generator.generateCompromise(TRIP_ID, 3, conflictAnalysis, TRIP_CONTEXT);
      const content = event.content as CompromiseContent;

      expect(content.satisfactionEstimates['carlos']).toBeGreaterThanOrEqual(0.60);
    });

    it('satisfactionEstimates.diana ≥ 0.60', async () => {
      const conflictAnalysis = JSON.parse(BUDGET_CONVERGENCE_ANALYSIS_RESPONSE);
      const event = await generator.generateCompromise(TRIP_ID, 3, conflictAnalysis, TRIP_CONTEXT);
      const content = event.content as CompromiseContent;

      expect(content.satisfactionEstimates['diana']).toBeGreaterThanOrEqual(0.60);
    });

    it('itinerary covers Sintra (day 1) and Cascais (day 2)', async () => {
      const conflictAnalysis = JSON.parse(BUDGET_CONVERGENCE_ANALYSIS_RESPONSE);
      const event = await generator.generateCompromise(TRIP_ID, 3, conflictAnalysis, TRIP_CONTEXT);
      const content = event.content as CompromiseContent;

      const days = content.itinerary.map((d) => d.day);
      expect(days).toContain(1);
      expect(days).toContain(2);

      const allText = JSON.stringify(content.itinerary);
      expect(allText).toMatch(/[Ss]intra/);
      expect(allText).toMatch(/[Cc]ascais/);
    });

    it('no single activity cost exceeds per-person daily budget of €37.50', async () => {
      const conflictAnalysis = JSON.parse(BUDGET_CONVERGENCE_ANALYSIS_RESPONSE);
      const event = await generator.generateCompromise(TRIP_ID, 3, conflictAnalysis, TRIP_CONTEXT);
      const content = event.content as CompromiseContent;

      const perPersonDailyBudget = BUDGET_TOTAL / 4 / 2; // €37.50
      for (const day of content.itinerary) {
        for (const activity of day.activities) {
          expect(activity.cost).toBeLessThanOrEqual(perPersonDailyBudget);
        }
      }
    });

    it('unresolvedConflicts is empty after budget convergence', async () => {
      const conflictAnalysis = JSON.parse(BUDGET_CONVERGENCE_ANALYSIS_RESPONSE);
      const event = await generator.generateCompromise(TRIP_ID, 3, conflictAnalysis, TRIP_CONTEXT);
      const content = event.content as CompromiseContent;

      expect(content.unresolvedConflicts).toHaveLength(0);
    });

    it('each activity satisfies at least one of the 4 participants', async () => {
      const conflictAnalysis = JSON.parse(BUDGET_CONVERGENCE_ANALYSIS_RESPONSE);
      const event = await generator.generateCompromise(TRIP_ID, 3, conflictAnalysis, TRIP_CONTEXT);
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
      const conflictAnalysis = JSON.parse(BUDGET_CONVERGENCE_ANALYSIS_RESPONSE);
      const event = await generator.generateCompromise(TRIP_ID, 3, conflictAnalysis, TRIP_CONTEXT);

      expect(event.tripId).toBe(TRIP_ID);
      expect(event.round).toBe(3);
      expect(event.type).toBe('agent.propose');
      expect(event.agent).toBe('orchestrator');
      expect(event.timestamp).toBeDefined();
      expect(event.metrics?.latencyMs).toBe(580);
      expect(event.metrics?.tokensUsed).toBe(430);
    });
  });

  // ---------------------------------------------------------------------------
  describe('End-to-end — finance flags overruns, orchestrator proposes cuts, ≥60% satisfied', () => {
    it('BudgetValidator flags initial combined proposals as over_budget', () => {
      const calculator = new CostCalculator();
      const validator = new BudgetValidator();
      const breakdown = calculator.calculate(OVER_BUDGET_ITINERARY, BUDGET_CURRENCY);

      const result = validator.validate(breakdown, BUDGET_TOTAL, BUDGET_CURRENCY);

      expect(result.status).toBe('over_budget');
      expect(result.overAmount).toBeGreaterThan(0);
    });

    it('AlternativeFinder calls Claude with over-budget context', async () => {
      vi.mocked(anthropic.complete).mockResolvedValue({
        content: BUDGET_ALTERNATIVES_RESPONSE,
        latencyMs: 380,
        tokensUsed: 290,
      });

      const calculator = new CostCalculator();
      const validator = new BudgetValidator();
      const breakdown = calculator.calculate(OVER_BUDGET_ITINERARY, BUDGET_CURRENCY);
      const validation = validator.validate(breakdown, BUDGET_TOTAL, BUDGET_CURRENCY);

      await alternativeFinder.findAlternatives(TRIP_ID, 1, OVER_BUDGET_ITINERARY, breakdown, validation, TRIP_CONTEXT);

      const callArgs = vi.mocked(anthropic.complete).mock.calls[0];
      const promptText = JSON.stringify(callArgs);
      expect(promptText).toContain('300');
      expect(promptText).toContain('Over budget by');
    });

    it('ConflictAnalyzer converges within 4 rounds under tight budget', async () => {
      vi.mocked(anthropic.complete)
        .mockResolvedValueOnce({ content: BUDGET_CONFLICT_ANALYSIS_RESPONSE, latencyMs: 440, tokensUsed: 320 })
        .mockResolvedValueOnce({ content: BUDGET_CONVERGENCE_ANALYSIS_RESPONSE, latencyMs: 360, tokensUsed: 270 })
        .mockResolvedValueOnce({ content: BUDGET_CONSTRAINED_COMPROMISE_RESPONSE, latencyMs: 580, tokensUsed: 430 });

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

    it('final compromise per-person total × 4 ≤ €300', async () => {
      vi.mocked(anthropic.complete)
        .mockResolvedValueOnce({ content: BUDGET_CONVERGENCE_ANALYSIS_RESPONSE, latencyMs: 360, tokensUsed: 270 })
        .mockResolvedValueOnce({ content: BUDGET_CONSTRAINED_COMPROMISE_RESPONSE, latencyMs: 580, tokensUsed: 430 });

      const analysis = await analyzer.analyze(TRIP_ID, 2, ALL_PROPOSALS);
      const compromise = await generator.generateCompromise(TRIP_ID, 2, analysis.content, TRIP_CONTEXT);
      const content = compromise.content as CompromiseContent;

      const totalPerPerson = content.itinerary
        .flatMap((day) => day.activities)
        .reduce((sum, act) => sum + act.cost, 0);

      expect(totalPerPerson * 4).toBeLessThanOrEqual(300);
    });

    it('all 4 traveller satisfactionEstimates ≥ 0.60 in final compromise', async () => {
      vi.mocked(anthropic.complete)
        .mockResolvedValueOnce({ content: BUDGET_CONVERGENCE_ANALYSIS_RESPONSE, latencyMs: 360, tokensUsed: 270 })
        .mockResolvedValueOnce({ content: BUDGET_CONSTRAINED_COMPROMISE_RESPONSE, latencyMs: 580, tokensUsed: 430 });

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
    it('AlternativeFinder wraps non-JSON Claude response as { raw: string }', async () => {
      vi.mocked(anthropic.complete).mockResolvedValue({
        content: NON_JSON_RESPONSE,
        latencyMs: 200,
        tokensUsed: 30,
      });

      const calculator = new CostCalculator();
      const validator = new BudgetValidator();
      const breakdown = calculator.calculate(OVER_BUDGET_ITINERARY, BUDGET_CURRENCY);
      const validation = validator.validate(breakdown, BUDGET_TOTAL, BUDGET_CURRENCY);

      const event = await alternativeFinder.findAlternatives(
        TRIP_ID, 1, OVER_BUDGET_ITINERARY, breakdown, validation, TRIP_CONTEXT,
      );
      const content = event.content as Record<string, unknown>;

      expect(content.alternatives).toEqual({ raw: NON_JSON_RESPONSE });
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

    it('CompromiseGenerator wraps non-JSON Claude response as { raw: string }', async () => {
      vi.mocked(anthropic.complete).mockResolvedValue({
        content: NON_JSON_RESPONSE,
        latencyMs: 200,
        tokensUsed: 30,
      });

      const conflictAnalysis = JSON.parse(BUDGET_CONVERGENCE_ANALYSIS_RESPONSE);
      const event = await generator.generateCompromise(TRIP_ID, 3, conflictAnalysis, TRIP_CONTEXT);

      expect(event.content).toEqual({ raw: NON_JSON_RESPONSE });
    });

    it('AlternativeFinder propagates Claude service errors', async () => {
      vi.mocked(anthropic.complete).mockRejectedValue(new Error('Anthropic API unavailable'));

      const calculator = new CostCalculator();
      const validator = new BudgetValidator();
      const breakdown = calculator.calculate(OVER_BUDGET_ITINERARY, BUDGET_CURRENCY);
      const validation = validator.validate(breakdown, BUDGET_TOTAL, BUDGET_CURRENCY);

      await expect(
        alternativeFinder.findAlternatives(TRIP_ID, 1, OVER_BUDGET_ITINERARY, breakdown, validation, TRIP_CONTEXT),
      ).rejects.toThrow();
    });

    it('ConflictAnalyzer propagates Claude service errors', async () => {
      vi.mocked(anthropic.complete).mockRejectedValue(new Error('Anthropic API unavailable'));

      await expect(analyzer.analyze(TRIP_ID, 1, ALL_PROPOSALS)).rejects.toThrow();
    });

    it('negotiation loop stops at round 6 even if budget conflicts persist', async () => {
      vi.mocked(anthropic.complete).mockResolvedValue({
        content: BUDGET_CONFLICT_ANALYSIS_RESPONSE, // overallConflictScore: 2.8
        latencyMs: 440,
        tokensUsed: 320,
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

import { BaseService, buildRoutingKey } from '@itinera/shared';
import type { AgentEvent } from '@itinera/shared';
import type { ConstraintChecker, Constraint, ConstraintCheckResult } from '@/validators/ConstraintChecker';
import type { ScoringEngine, TravellerPreference, ScoringResult } from '@/validators/ScoringEngine';
import type { FairnessCalculator, FairnessResult } from '@/validators/FairnessCalculator';
import type { MetricsCollector, MetricsResult } from '@/validators/MetricsCollector';
import type { RabbitMQPublisher } from '@/services/RabbitMQPublisher';
import type { ProposalStorageService } from '@/services/ProposalStorageService';
import {
  scoreFinanceCompliance,
  scoreLogisticsCompliance,
  combineScores,
} from '@/validators/ComplianceScorer';
import type {
  ComplianceScores,
  FinanceComplianceInput,
  LogisticsComplianceInput,
} from '@/validators/ComplianceScorer';

export interface ValidationResult {
  constraints: ConstraintCheckResult;
  scoring: ScoringResult;
  fairness: FairnessResult;
  metrics: MetricsResult;
  /** Per-axis breakdown. Absent when the caller sent no compliance data. */
  compliance?: ComplianceScores;
}

export class ValidationService extends BaseService {
  constructor(
    private readonly constraintChecker: ConstraintChecker,
    private readonly scoringEngine: ScoringEngine,
    private readonly fairnessCalculator: FairnessCalculator,
    private readonly metricsCollector: MetricsCollector,
    private readonly publisher: RabbitMQPublisher,
    private readonly storage: ProposalStorageService,
  ) {
    super('validation-service');
  }

  async validate(
    tripId: string,
    round: number,
    proposal: Record<string, unknown>,
    constraints: Constraint,
    travellers: TravellerPreference[],
    compliance?: { finance?: FinanceComplianceInput; logistics?: LogisticsComplianceInput },
  ): Promise<ValidationResult> {
    const start = Date.now();

    const constraintResult = this.constraintChecker.check(proposal, constraints);
    const scoringResult = this.scoringEngine.score(proposal, travellers);
    const fairnessResult = this.fairnessCalculator.calculate(scoringResult.scores);
    const metricsResult = this.metricsCollector.collect({
      round,
      scores: scoringResult.scores,
    });

    // Blend persona fit with finance/logistics compliance. Only computed when
    // the caller sent the data — an orchestrator on an older build gets exactly
    // the previous persona-only behaviour rather than a score of zero.
    let complianceScores: ComplianceScores | undefined;
    if (compliance?.finance || compliance?.logistics) {
      const financeScore = compliance.finance ? scoreFinanceCompliance(compliance.finance) : null;
      const logisticsScore = compliance.logistics ? scoreLogisticsCompliance(compliance.logistics) : null;
      complianceScores = combineScores(scoringResult.overallScore, financeScore, logisticsScore);
    }

    const result: ValidationResult = {
      constraints: constraintResult,
      scoring: complianceScores
        ? { ...scoringResult, overallScore: complianceScores.combinedScore }
        : scoringResult,
      fairness: fairnessResult,
      metrics: metricsResult,
      ...(complianceScores && { compliance: complianceScores }),
    };

    const event: AgentEvent = {
      tripId,
      type: 'agent.score',
      agent: 'validator',
      round,
      timestamp: new Date().toISOString(),
      content: result,
      metrics: { latencyMs: Date.now() - start, tokensUsed: 0 },
    };

    await this.storage.save(event);
    await this.publisher.publish(buildRoutingKey('validator', 'score'), event);

    this.logger.info('Validation complete', {
      tripId,
      round,
      passed: constraintResult.passed,
      overallScore: result.scoring.overallScore,
      personaScore: scoringResult.overallScore,
      financeScore: complianceScores?.financeScore ?? null,
      logisticsScore: complianceScores?.logisticsScore ?? null,
      cappedByBudget: complianceScores?.cappedByBudget ?? false,
      fairnessScore: fairnessResult.fairnessScore,
    });

    return result;
  }
}

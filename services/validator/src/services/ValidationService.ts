import { BaseService, buildRoutingKey } from '@itinera/shared';
import type { AgentEvent } from '@itinera/shared';
import type { ConstraintChecker, Constraint, ConstraintCheckResult } from '@/validators/ConstraintChecker';
import type { ScoringEngine, TravellerPreference, ScoringResult } from '@/validators/ScoringEngine';
import type { FairnessCalculator, FairnessResult } from '@/validators/FairnessCalculator';
import type { MetricsCollector, MetricsResult } from '@/validators/MetricsCollector';
import type { RabbitMQPublisher } from '@/services/RabbitMQPublisher';
import type { ProposalStorageService } from '@/services/ProposalStorageService';

export interface ValidationResult {
  constraints: ConstraintCheckResult;
  scoring: ScoringResult;
  fairness: FairnessResult;
  metrics: MetricsResult;
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
  ): Promise<ValidationResult> {
    const start = Date.now();

    const constraintResult = this.constraintChecker.check(proposal, constraints);
    const scoringResult = this.scoringEngine.score(proposal, travellers);
    const fairnessResult = this.fairnessCalculator.calculate(scoringResult.scores);
    const metricsResult = this.metricsCollector.collect({
      round,
      scores: scoringResult.scores,
    });

    const result: ValidationResult = {
      constraints: constraintResult,
      scoring: scoringResult,
      fairness: fairnessResult,
      metrics: metricsResult,
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
      overallScore: scoringResult.overallScore,
      fairnessScore: fairnessResult.fairnessScore,
    });

    return result;
  }
}

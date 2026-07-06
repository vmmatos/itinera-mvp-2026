import type {
  WorkflowAction,
  WorkflowActionType,
  WorkflowContext,
  WorkflowRetryTarget,
  WorkflowState,
} from '@itinera/shared';

export const MAX_RETRIES_PER_MODULE = 2;

export class WorkflowStateMachine {
  transition(context: WorkflowContext): { nextState: WorkflowState; action: WorkflowAction } {
    switch (context.currentState) {
      case 'INTAKE_COMPLETE':
        return {
          nextState: 'LOGISTICS_PLANNING',
          action: { type: 'CALL_LOGISTICS_PLAN', reason: 'Build structural route before any agent proposes experiences' },
        };

      case 'LOGISTICS_PLANNING':
        if (context.routeGraph) {
          return {
            nextState: 'FINANCE_ENVELOPE_CHECK',
            action: { type: 'CALL_FINANCE_ESTIMATE', reason: 'Validate budget envelope before committing tourist agent tokens' },
          };
        }
        return this.retryOrAbandon(context, 'logistics', 'LOGISTICS_PLANNING', 'CALL_LOGISTICS_PLAN');

      case 'FINANCE_ENVELOPE_CHECK':
        if (!context.budgetPlan) {
          return this.retryOrAbandon(context, 'finance', 'FINANCE_ENVELOPE_CHECK', 'CALL_FINANCE_ESTIMATE');
        }
        if (!context.budgetPlan.feasible) {
          return {
            nextState: 'ASK_REFINEMENT',
            action: { type: 'ASK_REFINEMENT', reason: 'Transport costs alone exceed budget — user must adjust before proceeding' },
          };
        }
        return {
          nextState: 'PARALLEL_TURISTIC_PLANNING',
          action: { type: 'CALL_TOURIST_AGENTS', reason: 'Route and budget validated — tourist agents fill slots' },
        };

      case 'PARALLEL_TURISTIC_PLANNING':
        if (context.touristAgentOutputs && Object.keys(context.touristAgentOutputs).length >= 4) {
          return {
            nextState: 'MERGE_AND_SCORE',
            action: { type: 'CALL_ORCHESTRATOR_MERGE', reason: 'All tourist agents complete — merge into unified itinerary' },
          };
        }
        return {
          nextState: 'PARALLEL_TURISTIC_PLANNING',
          action: { type: 'CALL_TOURIST_AGENTS', reason: 'Waiting for tourist agent outputs' },
        };

      case 'MERGE_AND_SCORE':
        if (context.mergedItinerary) {
          return {
            nextState: 'FINANCE_VALIDATE',
            action: { type: 'CALL_FINANCE_VALIDATE', reason: 'Full itinerary ready — validate actual costs against budget' },
          };
        }
        return this.retryOrAbandon(context, 'merge', 'MERGE_AND_SCORE', 'CALL_ORCHESTRATOR_MERGE');

      case 'FINANCE_VALIDATE': {
        const financeApproved = context.mergedItinerary
          ? (context.mergedItinerary as Record<string, unknown>)['_financeApproved'] === true
          : false;
        if (financeApproved) {
          return {
            nextState: 'FINAL_VALIDATION',
            action: { type: 'CALL_FINAL_VALIDATION', reason: 'Finance approved — run final constraint and scoring check' },
          };
        }
        return this.retryOrAbandon(context, 'finance', 'FINANCE_VALIDATE', 'CALL_FINANCE_VALIDATE');
      }

      case 'FINAL_VALIDATION': {
        const score = context.validationScore ?? 0;
        if (score >= 60) {
          return {
            nextState: 'FINISH',
            action: { type: 'FINISH', reason: 'All constraints passed and score meets threshold' },
          };
        }
        return {
          nextState: 'ASK_REFINEMENT',
          action: { type: 'ASK_REFINEMENT', reason: `Validation score ${score} below threshold 60` },
        };
      }

      case 'ASK_REFINEMENT':
      case 'FINISH':
        return {
          nextState: context.currentState,
          action: { type: context.currentState === 'FINISH' ? 'FINISH' : 'ASK_REFINEMENT' },
        };

      default:
        throw new Error(`Unknown workflow state: ${String(context.currentState)}`);
    }
  }

  routeRetry(
    target: WorkflowRetryTarget,
    retryCount: number,
    maxRetries: number = MAX_RETRIES_PER_MODULE,
  ): WorkflowState {
    if (retryCount < maxRetries) {
      return this.stateForTarget(target);
    }
    return 'ASK_REFINEMENT';
  }

  isTerminal(state: WorkflowState): boolean {
    return state === 'FINISH' || state === 'ASK_REFINEMENT';
  }

  private retryOrAbandon(
    context: WorkflowContext,
    target: WorkflowRetryTarget,
    retryState: WorkflowState,
    retryAction: WorkflowActionType,
  ): { nextState: WorkflowState; action: WorkflowAction } {
    const count = context.retryCount[target] ?? 0;
    if (count < MAX_RETRIES_PER_MODULE) {
      return {
        nextState: retryState,
        action: { type: 'LOCAL_RETRY', retryTarget: target, reason: `Retry ${count + 1}/${MAX_RETRIES_PER_MODULE} for ${target}` },
      };
    }
    return {
      nextState: 'ASK_REFINEMENT',
      action: { type: 'ASK_REFINEMENT', reason: `${target} failed after ${MAX_RETRIES_PER_MODULE} retries` },
    };
  }

  private stateForTarget(target: WorkflowRetryTarget): WorkflowState {
    const map: Record<WorkflowRetryTarget, WorkflowState> = {
      logistics: 'LOGISTICS_PLANNING',
      finance: 'FINANCE_VALIDATE',
      merge: 'MERGE_AND_SCORE',
    };
    return map[target];
  }
}

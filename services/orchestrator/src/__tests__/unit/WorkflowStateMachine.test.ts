import { describe, it, expect } from 'vitest';
import { WorkflowStateMachine, MAX_RETRIES_PER_MODULE } from '@/services/WorkflowStateMachine';
import type { WorkflowContext, RouteGraph, BudgetPlan } from '@itinera/shared';

const BASE_CONTEXT: WorkflowContext = {
  tripId: 'trip-1',
  origin: 'Mértola',
  destinations: [{ country: 'Spain', city: 'Barcelona', nights: 3 }],
  dates: { mode: 'fixed', startDate: '2026-08-10', endDate: '2026-08-20' },
  budgetTotal: 1800,
  budgetCurrency: 'EUR',
  preferredTransport: 'flight',
  pace: 'medium',
  mustHaves: [],
  avoids: [],
  groupSize: 2,
  currentState: 'INTAKE_COMPLETE',
  retryCount: {},
  errors: [],
  totalTokensUsed: 0,
  startedAt: '2026-08-01T10:00:00Z',
};

const ROUTE_GRAPH: RouteGraph = {
  orderedLegs: [],
  cityStays: [{ city: 'Barcelona', country: 'Spain', arrivalDate: '2026-08-10', departureDate: '2026-08-13', nights: 3, timeWindows: [], sleepPoint: 'Eixample', budgetPerPersonPerNight: 80 }],
  totalTransportCostEurPerPerson: 100,
  totalDurationDays: 3,
};

const FEASIBLE_BUDGET: BudgetPlan = {
  perBlock: [],
  totalEurPerPerson: 700,
  grandTotal: 1400,
  feasible: true,
  bufferPct: 22,
  currency: 'EUR',
};

const INFEASIBLE_BUDGET: BudgetPlan = { ...FEASIBLE_BUDGET, feasible: false, bufferPct: -5 };

const TOURIST_OUTPUTS = { alice: {}, bob: {}, carlos: {}, diana: {} };

const MERGED = { itinerary: [], accommodation: [], _financeApproved: true };

const fsm = new WorkflowStateMachine();

describe('WorkflowStateMachine.transition', () => {
  it('INTAKE_COMPLETE → LOGISTICS_PLANNING', () => {
    const { nextState, action } = fsm.transition({ ...BASE_CONTEXT, currentState: 'INTAKE_COMPLETE' });
    expect(nextState).toBe('LOGISTICS_PLANNING');
    expect(action.type).toBe('CALL_LOGISTICS_PLAN');
  });

  it('LOGISTICS_PLANNING with routeGraph → FINANCE_ENVELOPE_CHECK', () => {
    const ctx = { ...BASE_CONTEXT, currentState: 'LOGISTICS_PLANNING' as const, routeGraph: ROUTE_GRAPH };
    const { nextState, action } = fsm.transition(ctx);
    expect(nextState).toBe('FINANCE_ENVELOPE_CHECK');
    expect(action.type).toBe('CALL_FINANCE_ESTIMATE');
  });

  it('LOGISTICS_PLANNING without routeGraph → LOCAL_RETRY', () => {
    const ctx = { ...BASE_CONTEXT, currentState: 'LOGISTICS_PLANNING' as const };
    const { nextState, action } = fsm.transition(ctx);
    expect(nextState).toBe('LOGISTICS_PLANNING');
    expect(action.type).toBe('LOCAL_RETRY');
    expect(action.retryTarget).toBe('logistics');
  });

  it('LOGISTICS_PLANNING without routeGraph max retries → ASK_REFINEMENT', () => {
    const ctx = { ...BASE_CONTEXT, currentState: 'LOGISTICS_PLANNING' as const, retryCount: { logistics: MAX_RETRIES_PER_MODULE } };
    const { nextState, action } = fsm.transition(ctx);
    expect(nextState).toBe('ASK_REFINEMENT');
    expect(action.type).toBe('ASK_REFINEMENT');
  });

  it('FINANCE_ENVELOPE_CHECK feasible → PARALLEL_TURISTIC_PLANNING', () => {
    const ctx = { ...BASE_CONTEXT, currentState: 'FINANCE_ENVELOPE_CHECK' as const, routeGraph: ROUTE_GRAPH, budgetPlan: FEASIBLE_BUDGET };
    const { nextState, action } = fsm.transition(ctx);
    expect(nextState).toBe('PARALLEL_TURISTIC_PLANNING');
    expect(action.type).toBe('CALL_TOURIST_AGENTS');
  });

  it('FINANCE_ENVELOPE_CHECK infeasible → ASK_REFINEMENT immediately', () => {
    const ctx = { ...BASE_CONTEXT, currentState: 'FINANCE_ENVELOPE_CHECK' as const, routeGraph: ROUTE_GRAPH, budgetPlan: INFEASIBLE_BUDGET };
    const { nextState, action } = fsm.transition(ctx);
    expect(nextState).toBe('ASK_REFINEMENT');
    expect(action.type).toBe('ASK_REFINEMENT');
  });

  it('PARALLEL_TURISTIC_PLANNING all 4 outputs → MERGE_AND_SCORE', () => {
    const ctx = { ...BASE_CONTEXT, currentState: 'PARALLEL_TURISTIC_PLANNING' as const, touristAgentOutputs: TOURIST_OUTPUTS };
    const { nextState, action } = fsm.transition(ctx);
    expect(nextState).toBe('MERGE_AND_SCORE');
    expect(action.type).toBe('CALL_ORCHESTRATOR_MERGE');
  });

  it('PARALLEL_TURISTIC_PLANNING partial outputs → stay in state', () => {
    const ctx = { ...BASE_CONTEXT, currentState: 'PARALLEL_TURISTIC_PLANNING' as const, touristAgentOutputs: { alice: {} } };
    const { nextState, action } = fsm.transition(ctx);
    expect(nextState).toBe('PARALLEL_TURISTIC_PLANNING');
    expect(action.type).toBe('CALL_TOURIST_AGENTS');
  });

  it('MERGE_AND_SCORE with mergedItinerary → FINANCE_VALIDATE', () => {
    const ctx = { ...BASE_CONTEXT, currentState: 'MERGE_AND_SCORE' as const, mergedItinerary: MERGED };
    const { nextState, action } = fsm.transition(ctx);
    expect(nextState).toBe('FINANCE_VALIDATE');
    expect(action.type).toBe('CALL_FINANCE_VALIDATE');
  });

  it('MERGE_AND_SCORE without merged → LOCAL_RETRY', () => {
    const ctx = { ...BASE_CONTEXT, currentState: 'MERGE_AND_SCORE' as const };
    const { nextState, action } = fsm.transition(ctx);
    expect(nextState).toBe('MERGE_AND_SCORE');
    expect(action.type).toBe('LOCAL_RETRY');
    expect(action.retryTarget).toBe('merge');
  });

  it('FINANCE_VALIDATE approved → FINAL_VALIDATION', () => {
    const ctx = { ...BASE_CONTEXT, currentState: 'FINANCE_VALIDATE' as const, mergedItinerary: MERGED };
    const { nextState, action } = fsm.transition(ctx);
    expect(nextState).toBe('FINAL_VALIDATION');
    expect(action.type).toBe('CALL_FINAL_VALIDATION');
  });

  // Retrying FINANCE_VALIDATE on itself would re-review the exact same
  // unchanged mergedItinerary and get the exact same rejection every time —
  // it must route back through a real re-merge instead (see WorkflowEngine's
  // buildCostCuttingInstruction, fed by context.financeFeedback).
  it('FINANCE_VALIDATE not approved → LOCAL_RETRY via a real re-merge, not a re-review of the same itinerary', () => {
    const ctx = { ...BASE_CONTEXT, currentState: 'FINANCE_VALIDATE' as const, mergedItinerary: { ...MERGED, _financeApproved: false } };
    const { nextState, action } = fsm.transition(ctx);
    expect(nextState).toBe('MERGE_AND_SCORE');
    expect(action.type).toBe('LOCAL_RETRY');
    expect(action.retryTarget).toBe('finance');
  });

  it('FINANCE_VALIDATE max retries → ASK_REFINEMENT', () => {
    const ctx = { ...BASE_CONTEXT, currentState: 'FINANCE_VALIDATE' as const, mergedItinerary: { ...MERGED, _financeApproved: false }, retryCount: { finance: MAX_RETRIES_PER_MODULE } };
    const { nextState, action } = fsm.transition(ctx);
    expect(nextState).toBe('ASK_REFINEMENT');
    expect(action.type).toBe('ASK_REFINEMENT');
  });

  it('FINAL_VALIDATION score >= 60 → FINISH', () => {
    const ctx = { ...BASE_CONTEXT, currentState: 'FINAL_VALIDATION' as const, validationScore: 75 };
    const { nextState, action } = fsm.transition(ctx);
    expect(nextState).toBe('FINISH');
    expect(action.type).toBe('FINISH');
  });

  // Same reasoning as FINANCE_VALIDATE above: a low score must route back
  // through a real re-merge (see WorkflowEngine's buildPersonaRebalanceInstruction,
  // fed by context.scoreFeedback), not just retry the identical scoring call.
  it('FINAL_VALIDATION score < 60 → LOCAL_RETRY via a real re-merge, not an immediate cancel', () => {
    const ctx = { ...BASE_CONTEXT, currentState: 'FINAL_VALIDATION' as const, validationScore: 45 };
    const { nextState, action } = fsm.transition(ctx);
    expect(nextState).toBe('MERGE_AND_SCORE');
    expect(action.type).toBe('LOCAL_RETRY');
    expect(action.retryTarget).toBe('validation');
  });

  it('FINAL_VALIDATION score < 60 max retries → ASK_REFINEMENT', () => {
    const ctx = { ...BASE_CONTEXT, currentState: 'FINAL_VALIDATION' as const, validationScore: 45, retryCount: { validation: MAX_RETRIES_PER_MODULE } };
    const { nextState, action } = fsm.transition(ctx);
    expect(nextState).toBe('ASK_REFINEMENT');
    expect(action.type).toBe('ASK_REFINEMENT');
  });
});

describe('WorkflowStateMachine.routeRetry', () => {
  it('returns state for target when retries remain', () => {
    expect(fsm.routeRetry('logistics', 0)).toBe('LOGISTICS_PLANNING');
    expect(fsm.routeRetry('finance', 1)).toBe('FINANCE_VALIDATE');
    expect(fsm.routeRetry('merge', 0)).toBe('MERGE_AND_SCORE');
    expect(fsm.routeRetry('validation', 0)).toBe('MERGE_AND_SCORE');
  });

  it('returns ASK_REFINEMENT when max retries reached', () => {
    expect(fsm.routeRetry('logistics', MAX_RETRIES_PER_MODULE)).toBe('ASK_REFINEMENT');
    expect(fsm.routeRetry('merge', MAX_RETRIES_PER_MODULE)).toBe('ASK_REFINEMENT');
    expect(fsm.routeRetry('validation', MAX_RETRIES_PER_MODULE)).toBe('ASK_REFINEMENT');
  });
});

describe('WorkflowStateMachine.isTerminal', () => {
  it('FINISH and ASK_REFINEMENT are terminal', () => {
    expect(fsm.isTerminal('FINISH')).toBe(true);
    expect(fsm.isTerminal('ASK_REFINEMENT')).toBe(true);
  });

  it('non-terminal states return false', () => {
    expect(fsm.isTerminal('LOGISTICS_PLANNING')).toBe(false);
    expect(fsm.isTerminal('PARALLEL_TURISTIC_PLANNING')).toBe(false);
    expect(fsm.isTerminal('MERGE_AND_SCORE')).toBe(false);
  });
});

import type { DateInput, TransportMode, TransportOption } from './entities';
import type { Pace, PersonaKey } from './preferences';
import type { SuggestedCut } from './budget';

export type WorkflowState =
  | 'INTAKE_COMPLETE'
  | 'LOGISTICS_PLANNING'
  | 'FINANCE_ENVELOPE_CHECK'
  | 'PARALLEL_TURISTIC_PLANNING'
  | 'MERGE_AND_SCORE'
  | 'FINANCE_VALIDATE'
  | 'FINAL_VALIDATION'
  | 'ASK_REFINEMENT'
  | 'FINISH';

export interface TimeWindow {
  date: string;
  slot: 'morning' | 'afternoon' | 'evening';
  durationMinutes: number;
  isTransitDay: boolean;
  /** Why this slot is blocked. Absent when isTransitDay=false. */
  blockedReason?: 'inbound-transit' | 'inbound-recovery' | 'outbound-transit';
}

export interface TransportLeg {
  from: string;
  to: string;
  departureDate: string;
  bestOption: TransportOption;
  alternatives: TransportOption[];
  totalCostEurPerPerson: number;
}

export interface CityStay {
  city: string;
  country: string;
  arrivalDate: string;
  departureDate: string;
  nights: number;
  timeWindows: TimeWindow[];
  sleepPoint: string;
  budgetPerPersonPerNight: number;
}

export interface RouteGraph {
  orderedLegs: TransportLeg[];
  cityStays: CityStay[];
  totalTransportCostEurPerPerson: number;
  totalDurationDays: number;
  /**
   * Day-trip round-trip legs detected post-merge (e.g. Sintra from a Lisbon
   * base) — populated after MERGE_AND_SCORE, once venues are known.
   * Traceability/admin display only; the actual budget effect flows through
   * the merged itinerary's day.transport[] entries, not this field.
   */
  satelliteLegs?: TransportLeg[];
}

export interface BudgetBlock {
  city: string;
  transportCostEurPerPerson: number;
  accommodationBudgetEurPerPerson: number;
  experiencesBudgetEurPerPerson: number;
  totalEurPerPerson: number;
}

export interface BudgetPlan {
  perBlock: BudgetBlock[];
  totalEurPerPerson: number;
  grandTotal: number;
  feasible: boolean;
  bufferPct: number;
  currency: string;
}

export interface TouristSlotInput {
  tripId: string;
  round: number;
  city: string;
  country: string;
  dateWindow: { start: string; end: string };
  availableTimeSlots: TimeWindow[];
  budgetPerPersonBlock: number;
  currency: string;
  pace: Pace;
  mustHaves: string[];
  avoids: string[];
  groupSize: number;
}

export interface TransportPriorityResult {
  selectedMode: TransportMode;
  selectedOption: TransportOption;
  wasPreferenceHonored: boolean;
  downgradeReason?: string;
}

/**
 * Set when finance rejects the merged itinerary — read by the next merge
 * retry so it actually steers the LLM toward cutting cost in the flagged
 * categories, instead of blindly re-submitting the same itinerary and
 * getting the same rejection. Cleared once finance approves.
 */
export interface FinanceFeedback {
  overAmountTotal: number;
  overAmountPerPerson: number;
  issues: string[];
  suggestedCuts: SuggestedCut[];
}

/** One real traveller who scored too low against the merged itinerary. */
export interface LowScoringTraveller {
  label: string;
  persona: PersonaKey | null;
  score: number;
  /** This persona's interest categories the itinerary has little/no content for. */
  missingCategories: string[];
}

/**
 * Set when the validator scores the merged itinerary below the FINAL_VALIDATION
 * threshold — read by the next merge retry so it actually steers the LLM toward
 * the personas/categories the group is missing, instead of blindly re-submitting
 * the same itinerary and getting the same low score. Cleared once the score
 * clears the threshold.
 */
export interface ScoreFeedback {
  overallScore: number;
  lowScoringTravellers: LowScoringTraveller[];
  /** Which axis dragged the score down — drives which retry instruction is
   * built. A budget failure must not produce a persona-rebalance instruction. */
  primaryCause?: 'persona' | 'budget' | 'logistics';
}

/**
 * The three axes behind the single FINAL_VALIDATION score. `finance`/`logistics`
 * are null when the validator had no data for that axis.
 */
export interface ScoreBreakdown {
  personaScore: number;
  financeScore: number | null;
  logisticsScore: number | null;
  combinedScore: number;
  /** True when a budget blowout capped the combined score below the threshold. */
  cappedByBudget?: boolean;
}

export interface RestrictionWarning {
  day: number;
  activityName: string;
  warningType: 'public_holiday' | 'sunday_closure' | 'monday_closure' | 'opening_hours';
  message: string;
}

export interface WeatherAffectedActivity {
  name: string;
  venue: string;
  risk: 'low' | 'medium' | 'high';
  reason: string;
  suggestion: string | null;
}

export interface WeatherDayAssessment {
  day: number;
  date: string | null;
  weatherRisk: 'low' | 'medium' | 'high';
  affectedActivities: WeatherAffectedActivity[];
  /** Real forecast passthrough (OpenWeatherMap) — absent when no forecast matched this date. */
  tempHigh?: number;
  tempLow?: number;
  condition?: string;
  precipitationProbability?: number;
}

export interface WeatherTimingIssue {
  day: number;
  activity1: string;
  activity2: string;
  issue: string;
  suggestion: string;
}

export interface WeatherAssessment {
  overallRisk: 'low' | 'medium' | 'high';
  dayAssessments: WeatherDayAssessment[];
  timingIssues: WeatherTimingIssue[];
  summary: string;
  suggestedDates?: { startDate?: string; endDate?: string; rationale: string };
}

export type WorkflowActionType =
  | 'CALL_LOGISTICS_PLAN'
  | 'CALL_FINANCE_ESTIMATE'
  | 'ENFORCE_TRANSPORT_PRIORITY'
  | 'CALL_TOURIST_AGENTS'
  | 'CALL_ORCHESTRATOR_MERGE'
  | 'CALL_FINANCE_VALIDATE'
  | 'CALL_FINAL_VALIDATION'
  | 'LOCAL_RETRY'
  | 'FINISH'
  | 'REJECT'
  | 'ASK_REFINEMENT';

export type WorkflowRetryTarget = 'logistics' | 'finance' | 'merge' | 'validation';

export interface WorkflowAction {
  type: WorkflowActionType;
  retryTarget?: WorkflowRetryTarget;
  reason?: string;
}

export interface WorkflowContext {
  tripId: string;
  origin: string;
  destinations: Array<{ country: string; city?: string; nights: number }>;
  dates: DateInput;
  budgetTotal: number;
  budgetCurrency: string;
  preferredTransport: TransportMode;
  pace: Pace;
  mustHaves: string[];
  avoids: string[];
  groupSize: number;
  routeGraph?: RouteGraph;
  /** First-leg priority result (kept for dashboard/scenario back-compat). */
  transportPriority?: TransportPriorityResult;
  /** Per-leg priority results, aligned with routeGraph.orderedLegs. */
  transportPriorities?: TransportPriorityResult[];
  budgetPlan?: BudgetPlan;
  touristAgentOutputs?: Record<string, unknown>;
  mergedItinerary?: Record<string, unknown>;
  financeFeedback?: FinanceFeedback;
  /**
   * What the merged itinerary actually costs the group, as computed by finance
   * at FINANCE_VALIDATE. Kept separate from `financeFeedback` (which is cleared
   * on approval) because the final validation needs the real figure whether
   * finance approved or not, to score the budget axis — see ComplianceScorer.
   */
  actualCostTotal?: number;
  validationScore?: number;
  scoreFeedback?: ScoreFeedback;
  /** Per-axis breakdown behind `validationScore`. */
  scoreBreakdown?: ScoreBreakdown;
  currentState: WorkflowState;
  retryCount: Partial<Record<WorkflowRetryTarget, number>>;
  errors: string[];
  totalTokensUsed: number;
  startedAt: string;
}

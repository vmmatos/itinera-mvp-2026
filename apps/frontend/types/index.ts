// ─────────────────────────────────────────────────────────────
//  itinera frontend — shared types
//  Mirrors @itinera/shared but safe to import in Nuxt pages
// ─────────────────────────────────────────────────────────────

export type Currency = 'EUR' | 'USD'

export type TripStatus =
  | 'draft'
  | 'negotiating'
  | 'confirmed'
  | 'completed'
  | 'cancelled'

export type AgentName =
  | 'alice'
  | 'bob'
  | 'carlos'
  | 'diana'
  | 'orchestrator'
  | 'finance'
  | 'logistics'
  | 'validator'

export type AgentAction =
  | 'propose'
  | 'refine'
  | 'accept'
  | 'reject'
  | 'score'
  | 'notification'

export type Persona = 'culture' | 'relaxation' | 'action' | 'gastronomy'
export type Flexibility = 'low' | 'medium' | 'high'

// ── Agent colour mapping (matches design tokens) ──────────────
export const AGENT_COLOURS: Record<AgentName, string> = {
  alice:        'green',
  bob:          'amber',
  carlos:       'blue',
  diana:        'magenta',
  orchestrator: 'green',
  finance:      'amber',
  logistics:    'blue',
  validator:    'magenta',
}

export const PERSONA_LABELS: Record<Persona, string> = {
  culture:     'Culture & Museums',
  relaxation:  'Relaxation & Beach',
  action:      'Action & Hiking',
  gastronomy:  'Gastronomy',
}

export const PERSONA_AGENT: Record<Persona, AgentName> = {
  culture:    'alice',
  relaxation: 'bob',
  action:     'carlos',
  gastronomy: 'diana',
}

// ── Date input ────────────────────────────────────────────────
export type DateWindow = 'tight' | 'moderate' | 'open'

export interface FixedDateInput {
  mode:      'fixed'
  startDate: string  // YYYY-MM-DD
  endDate:   string  // YYYY-MM-DD
}

export interface FlexibleDateInput {
  mode:           'flexible'
  days:           number
  preferredMonth?: string  // YYYY-MM
  window:         DateWindow
  resolvedStart?: string
  resolvedEnd?:   string
  rationale?:     string
}

export type DateInput = FixedDateInput | FlexibleDateInput

// ── Transport ─────────────────────────────────────────────────
export type TransportMode = 'flight' | 'train' | 'car' | 'best'

export interface TransportSegment {
  from:            string
  to:              string
  mode:            'flight' | 'train' | 'bus' | 'car'
  provider?:       string
  durationMinutes: number
  priceEur?:       number
  departureTime?:  string
  flightNumber?:   string
  trainLine?:      string
  /** Departure stop / station name (e.g. "Grândola train station") */
  fromStop?:       string
  /** Arrival stop / station name (e.g. "Faro Airport") */
  toStop?:         string
}

export interface TransportOption {
  mode:            'flight' | 'train' | 'car' | 'bus'
  provider?:       string
  durationMinutes: number
  departureTime?:  string
  arrivalTime?:    string
  priceEur?:       number
  flightNumber?:   string
  trainLine?:      string
  warnings:        string[]
  /** Present for multi-leg routes composed via hub routing. */
  segments?:       TransportSegment[]
  /** Human-readable summary, e.g. "Bus + Train + Flight — 9h, ~€172/person" */
  displaySummary?: string
  /** For flights: departure airport code + name, e.g. "FAO – Faro Airport" */
  originAirport?:      string
  /** For flights: arrival airport code + name, e.g. "BCN – Barcelona–El Prat" */
  destinationAirport?: string
  /** Departure stop / station name (direct routes) */
  fromStop?:       string
  /** Arrival stop / station name (direct routes) */
  toStop?:         string
}

export interface TransportActivityData {
  to:             string
  selectedOption: TransportOption
  alternatives:   TransportOption[]
}

// ── Itinerary day (Step 4) ───────────────────────────────────────
// Shared shape produced by TripInputForm.vue's timelineDays computed
// (see buildDays()) and consumed by the itinerary review components.
export interface ItineraryActivity {
  name:           string
  time?:          string
  location?:      string
  venue?:         string
  city?:          string
  country?:       string
  ownerAgent?:    string
  notes?:         string
  cost?:          number
  weatherAlert?:  string
  satisfies?:     string[]
  transportData?: TransportActivityData
}

export interface ItineraryCityTransition {
  to:         string
  travelTime: string
}

export interface ItineraryDay {
  day:             number
  date?:           string
  city?:           string
  country?:        string
  cityTransition?: ItineraryCityTransition
  activities:      ItineraryActivity[]
  meals?:          Array<{ type: string; name: string }>
  // Per-day transport legs from the merged itinerary; preferred over logistics options.
  rawTransport?:   Array<Record<string, unknown>>
}

// ── Trip input ────────────────────────────────────────────────
export interface Destination {
  country: string
  city?:   string
  nights:  number
}

export interface TravellerInput {
  userId?:     string
  name?:       string   // frontend-only: preserved in lastInput for pre-fill
  preferences: {
    persona:      Persona
    flexibility:  Flexibility
    pace?:        Flexibility
    budgetLimit?: number
    dietary:      string[]
    constraints:  string[]
    mustHaves:    string[]
    dealBreakers: string[]
  }
}

export interface CreateTripInput {
  name:                string
  destinations:        Destination[]
  region?:             string   // derived from destinations if not set
  dateInput:           DateInput
  budgetTotal:         number
  budgetCurrency:      Currency
  travellers:          TravellerInput[]
  transportPreference?: TransportMode
}

// ── Budget breakdown (issue #73) ───────────────────────────────
export type BudgetCategory = 'accommodation' | 'restaurants' | 'activities' | 'transport' | 'buffer'

export interface BudgetCategoryDetail {
  amountPerPerson: number
  amountTotal:     number
  isEstimate:      boolean
  source:          string
}

export interface BudgetOverrun {
  category:           BudgetCategory
  overAmountPerPerson: number
  overAmountTotal:     number
}

export interface SuggestedCut {
  category:        Exclude<BudgetCategory, 'buffer'>
  description:     string
  savingPerPerson: number
  savingTotal:     number
}

export interface BudgetBreakdown {
  currency:         string
  currencyMismatch: boolean
  groupSize:        number
  categories:       Record<BudgetCategory, BudgetCategoryDetail>
  perPersonTotal:   number
  grandTotal:       number
  budgetTotal:      number
  status:           'within_budget' | 'over_budget'
  percentageUsed:   number
  overruns:         BudgetOverrun[]
  suggestedCuts:    SuggestedCut[]
}

// ── Trip result ───────────────────────────────────────────────
export interface CityTransition {
  to:               string
  travelTime:       string
  transportOption?: TransportOption
}

export interface Activity {
  time:      string
  name:      string
  location:  string
  duration:  string
  cost?:     number
  agent?:    AgentName   // which agent "owns" this decision
  venue?:    string
  city?:     string
  country?:  string
  notes?:    string
  weatherAlert?: string
}

export interface DayPlan {
  date:            string
  title:           string
  city?:           string
  country?:        string
  cityTransition?: CityTransition
  activities:      Activity[]
}

export interface FinalPlan {
  days:            DayPlan[]
  totalCost:       number
  currency:        Currency
  weatherAlerts:   string[]
  bookingRequired: string[]
}

export interface SatisfactionScore {
  travellerId: string
  name:        string
  persona:     Persona
  preScore:    number
  postScore:   number
  breakdown:   Record<string, number>
}

// ── Weather assessment (Step 4) ─────────────────────────────────
// Typed mirror of the shared backend WeatherAssessment/WeatherDayAssessment
// (services/shared/src/types/workflow.ts), narrowed defensively at the
// boundary from the loose Record<string,unknown> the orchestrator proposal
// carries it as. tempHigh/tempLow/condition/precipitationProbability are
// absent when no real forecast matched a day (flexible dates with no month,
// or a date OpenWeatherMap had no data for) — never fabricate them client-side.
export interface WeatherDayAssessment {
  day:         number
  date:        string | null
  weatherRisk: 'low' | 'medium' | 'high'
  tempHigh?:   number
  tempLow?:    number
  condition?:  string
  precipitationProbability?: number
}

export interface WeatherTimingIssue {
  day:        number
  activity1:  string
  activity2:  string
  issue:      string
  suggestion: string
}

export interface WeatherAssessment {
  overallRisk:    'low' | 'medium' | 'high'
  dayAssessments: WeatherDayAssessment[]
  timingIssues:   WeatherTimingIssue[]
  summary:        string
}

export interface TripMetrics {
  convergenceRounds: number
  fairnessScore:     number
  autonomyScore:     number
  totalTimeMs:       number
  totalTokensUsed:   number
}

export interface Trip {
  id:             string
  name:           string
  status:         TripStatus
  region:         string
  startDate:      string
  endDate:        string
  budgetTotal:    number
  budgetCurrency: Currency
  dateInput?:     DateInput | null
  finalPlan?:     FinalPlan
  ownerId?:       string
  ownerName?:     string
  ownerEmail?:    string
  workflowState?: string | null
  createdAt:      string
  updatedAt:      string
}

// ── Debug data (admin mode only) ──────────────────────────────
export interface ProposalRound {
  id:        string
  round:     number
  agent:     AgentName
  action:    AgentAction
  content:   unknown
  reasoning?: string
  createdAt: string
}

export interface AgentLogEntry {
  id:         string
  agent:      AgentName
  round:      number
  action:     AgentAction
  latencyMs:  number
  tokensUsed: number
  reasoning?: string
  error?:     string
  createdAt:  string
}

export interface TripDebugData extends Trip {
  proposals:  ProposalRound[]
  agentLogs:  AgentLogEntry[]
  metrics:    TripMetrics[]
  scores:     SatisfactionScore[]
}

// ── SSE event (from ws-relay) ─────────────────────────────────
// `type` is a free string in practice (e.g. 'agent.propose', 'workflow.merge_and_score',
// 'negotiation_complete') — not constrained to AgentAction, which only describes the
// fixed RabbitMQ routing-key segment, not the real event semantics.
export interface AgentStreamEvent {
  tripId:    string
  type:      string
  agent:     AgentName
  round:     number
  timestamp: string
  content:   unknown
  reasoning?: string
  metrics?: {
    latencyMs:  number
    tokensUsed: number
  }
}

// ── Negotiate v2 — orchestrator pipeline + live decision stream ────────────
// Real WorkflowEngine states relevant to the negotiate step (excludes
// INTAKE_COMPLETE/ASK_REFINEMENT/FINISH, which aren't pipeline stages).
export type WorkflowState =
  | 'LOGISTICS_PLANNING'
  | 'FINANCE_ENVELOPE_CHECK'
  | 'PARALLEL_TURISTIC_PLANNING'
  | 'MERGE_AND_SCORE'
  | 'FINANCE_VALIDATE'
  | 'FINAL_VALIDATION'

export interface SlotProposal {
  id:        string
  city:      string
  date:      string
  slot:      'morning' | 'afternoon' | 'evening'
  activity:  string
  venue?:    string
  category?: string
  description?: string
  estimatedCostPerPerson: number
  durationMinutes?: number
  satisfies?: string[]
}

export type ProposalDecisionStatus = 'accepted' | 'merged' | 'rejected'

export interface ProposalDecision {
  proposalId: string
  agent:     string
  city:      string
  date:      string
  slot:      'morning' | 'afternoon' | 'evening'
  activity:  string
  status:    ProposalDecisionStatus
  reason:    string
  estimatedCostPerPerson?: number
}

export interface StageInfo {
  id:     WorkflowState
  label:  string
  status: 'queued' | 'running' | 'done'
}

export interface AgentCardState {
  id:         string
  color:      string
  role:       'traveller' | 'service'
  state:      'idle' | 'thinking' | 'proposing'
  lastAction: string | null
  proposalCount: number
}

export type DecisionStreamChip = 'pending' | 'accepted' | 'merged' | 'rejected' | 'applied'

export interface DecisionStreamEvent {
  id:       string
  who:      string
  color:    string
  kind:     string
  body:     string
  facts:    Array<[string, string]>
  chip:     DecisionStreamChip
  decisionReason?: string
  slotPayload?: { day: number; slot: 'morning' | 'afternoon' | 'evening'; name: string; by: string; cost: number } | null
  timestamp: string
}

export interface DraftSlot {
  status: 'empty' | 'filled' | 'reserved'
  name?:  string
  by?:    string
  color?: string
  cost?:  number
  decisionStatus?: ProposalDecisionStatus
  reason?: string
}

export interface DraftDay {
  day:   number
  date:  string
  city:  string
  slots: Record<'morning' | 'afternoon' | 'evening', DraftSlot>
}

export interface NegotiationSession {
  status:      'negotiating' | 'complete'
  startedAt:   number | null
  lastEventAt: number | null
}

export interface NegotiationState {
  session:     NegotiationSession
  stages:      StageInfo[]
  agents:      AgentCardState[]
  events:      DecisionStreamEvent[]
  slots:       DraftDay[]
  budgetTotal: number
}

// ── API responses ─────────────────────────────────────────────
export interface CreateTripResponse {
  tripId:  string
  status:  TripStatus
  message: string
}

export interface ApiError {
  error:    string
  details?: unknown
}

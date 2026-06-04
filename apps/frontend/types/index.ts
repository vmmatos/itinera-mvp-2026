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

// ── Trip input ────────────────────────────────────────────────
export interface Destination {
  country: string
  city?:   string
  nights:  number
}

export interface TravellerInput {
  userId?:     string
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
  name:           string
  destinations:   Destination[]
  region?:        string        // derived from destinations if not set
  startDate:      string        // YYYY-MM-DD
  endDate?:       string        // YYYY-MM-DD — auto-calculated from sum of nights
  budgetTotal:    number
  budgetCurrency: Currency
  travellers:     TravellerInput[]
}

// ── Trip result ───────────────────────────────────────────────
export interface Activity {
  time:      string
  name:      string
  location:  string
  duration:  string
  cost?:     number
  agent?:    AgentName   // which agent "owns" this decision
  notes?:    string
  weatherAlert?: string
}

export interface DayPlan {
  date:       string
  title:      string
  activities: Activity[]
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
  finalPlan?:     FinalPlan
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
export interface AgentStreamEvent {
  tripId:    string
  type:      AgentAction
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

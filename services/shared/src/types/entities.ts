export type TripStatus = 'draft' | 'negotiating' | 'confirmed' | 'completed' | 'cancelled' | 'rejected';
type ProposalStatus = 'pending' | 'accepted' | 'rejected' | 'superseded';
export type UserRole = 'user' | 'admin' | 'service';
export type DateWindow = 'tight' | 'moderate' | 'open';

export interface FixedDateInput {
  mode: 'fixed';
  startDate: string; // YYYY-MM-DD
  endDate: string;   // YYYY-MM-DD
}

export interface FlexibleDateInput {
  mode: 'flexible';
  days: number;
  preferredMonth?: string; // YYYY-MM
  window: DateWindow;
  resolvedStart?: string;
  resolvedEnd?: string;
  rationale?: string;
}

export type DateInput = FixedDateInput | FlexibleDateInput;

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  createdAt: Date;
  updatedAt: Date;
}

export interface Trip {
  id: string;
  name: string;
  status: TripStatus;
  ownerId: string;
  startDate: Date | null;
  endDate: Date | null;
  budgetTotal: number | null;
  budgetCurrency: string;
  dateInput: DateInput | null;
  transportPreference: TransportMode;
  createdAt: Date;
  updatedAt: Date;
}

export interface Traveller {
  id: string;
  tripId: string;
  userId: string;
  preferences: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface Proposal {
  id: string;
  tripId: string;
  agent: string;
  round: number;
  content: Record<string, unknown>;
  score: number | null;
  status: ProposalStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface AgentLog {
  id: string;
  tripId: string;
  agent: string;
  round: number;
  action: string;
  latencyMs: number | null;
  tokensUsed: number | null;
  reasoning: string | null;
  createdAt: Date;
}

export interface SatisfactionScore {
  id: string;
  tripId: string;
  userId: string;
  score: number;
  feedback: string | null;
  createdAt: Date;
}

export interface TripMetric {
  id: string;
  tripId: string;
  round: number;
  consensusScore: number | null;
  conflictCount: number;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

export interface Attraction {
  id: string;
  name: string;
  location: string;
  category: string;
  entryPrice: number | null;
  entryPriceCurrency: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export type TransportMode = 'flight' | 'train' | 'car' | 'best';

export interface TransportSegment {
  from: string;
  to: string;
  mode: 'flight' | 'train' | 'bus' | 'car';
  provider?: string;
  durationMinutes: number;
  priceEur?: number;
  departureTime?: string;
  flightNumber?: string;
  trainLine?: string;
  /** Departure stop/station/airport name (e.g. "Grândola train station", "Faro Airport") */
  fromStop?: string;
  /** Arrival stop/station/airport name */
  toStop?: string;
}

export interface TransportOption {
  mode: 'flight' | 'train' | 'car' | 'bus';
  provider?: string;
  durationMinutes: number;
  departureTime?: string;
  arrivalTime?: string;
  priceEur?: number;
  flightNumber?: string;
  trainLine?: string;
  warnings: string[];
  /** Present for multi-leg routes composed via hub routing. */
  segments?: TransportSegment[];
  /** Human-readable summary, e.g. "Bus + Train + Flight — 9h, ~€172/person" */
  displaySummary?: string;
  /** For flights: departure airport code + name, e.g. "FAO – Faro Airport" */
  originAirport?: string;
  /** For flights: arrival airport code + name, e.g. "BCN – Barcelona–El Prat" */
  destinationAirport?: string;
  /** Departure stop / station name (populated for train segments from Google Routes) */
  fromStop?: string;
  /** Arrival stop / station name */
  toStop?: string;
}

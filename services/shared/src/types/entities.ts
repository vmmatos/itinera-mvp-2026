export type TripStatus = 'draft' | 'negotiating' | 'confirmed' | 'completed' | 'cancelled';
export type ProposalStatus = 'pending' | 'accepted' | 'rejected' | 'superseded';
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
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export type TransportMode = 'flight' | 'train' | 'car' | 'best';

export interface TransportOption {
  mode: 'flight' | 'train' | 'car';
  provider?: string;
  durationMinutes: number;
  departureTime?: string;
  arrivalTime?: string;
  priceEur?: number;
  flightNumber?: string;
  trainLine?: string;
  warnings: string[];
}

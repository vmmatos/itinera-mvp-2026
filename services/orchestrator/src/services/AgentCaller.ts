import { BaseService } from '@itinera/shared';
import type { DateInput, TransportMode, RouteGraph, BudgetPlan, TouristSlotInput, RestrictionWarning, GroupPreferences, TransportLeg, FinanceFeedback } from '@itinera/shared';
import jwt from 'jsonwebtoken';
import { config } from '@/config';

export interface AgentCallResult {
  content: Record<string, unknown>;
  reasoning?: string;
  latencyMs: number;
  tokensUsed: number;
}

export interface AgentTripContext {
  budgetTotal?: number | null;
  budgetCurrency?: string;
  region?: string | null;
  dateInput?: DateInput | null;
  transportPreference?: TransportMode;
  groupSize?: number;
}

/** Mirrors the validator's ComplianceSchema — see ComplianceScorer. */
export interface ValidatorComplianceInput {
  finance?: { budgetTotal: number; actualTotal: number };
  logistics?: {
    transportDowngrades?: number;
    restrictionWarnings?: number;
    weatherRisk?: 'low' | 'medium' | 'high';
  };
}

interface AgentEventLike {
  content?: unknown;
  reasoning?: string;
  metrics?: { latencyMs?: number; tokensUsed?: number };
}

const SERVICE_URLS: Record<string, string> = {
  'preference-agent': config.PREFERENCE_AGENT_URL,
  'orchestrator-agent': config.ORCHESTRATOR_AGENT_URL,
  finance: config.FINANCE_AGENT_URL,
  logistics: config.LOGISTICS_AGENT_URL,
  validator: config.VALIDATOR_URL,
};

function buildServiceToken(): string {
  return jwt.sign(
    { sub: 'orchestrator', role: 'service', iss: config.JWT_ISSUER ?? 'itinera' },
    config.JWT_SECRET,
    { expiresIn: '1h' },
  );
}

function toAgentCallResult(event: AgentEventLike | undefined, fallbackMs: number): AgentCallResult {
  return {
    content: (event?.content ?? {}) as Record<string, unknown>,
    reasoning: event?.reasoning,
    latencyMs: event?.metrics?.latencyMs ?? fallbackMs,
    tokensUsed: event?.metrics?.tokensUsed ?? 0,
  };
}

export class AgentCaller extends BaseService {
  constructor() {
    super('agent-caller');
  }

  private async post<T>(service: string, path: string, body: unknown): Promise<T> {
    const baseUrl = SERVICE_URLS[service];
    if (!baseUrl) throw new Error(`Unknown service: ${service}`);
    const start = Date.now();
    const response = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${buildServiceToken()}`,
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`${service} returned ${response.status}: ${text}`);
    }
    this.logger.debug('Agent call completed', { service, path, latencyMs: Date.now() - start });
    return response.json() as Promise<T>;
  }

  async callFinanceAgent(
    tripId: string,
    round: number,
    proposal: Record<string, unknown>,
    tripContext?: AgentTripContext,
  ): Promise<AgentCallResult> {
    const start = Date.now();
    const resp = await this.post<{ review: AgentEventLike }>(
      'finance',
      '/review',
      {
        tripId,
        round,
        proposal,
        budgetTotal: Number(tripContext?.budgetTotal ?? 5000),
        budgetCurrency: tripContext?.budgetCurrency ?? 'EUR',
        groupSize: tripContext?.groupSize ?? 1,
        dateInput: tripContext?.dateInput ?? null,
      },
    );
    return toAgentCallResult(resp.review, Date.now() - start);
  }

  /**
   * `groupPreferences` carries the trip-level must-haves/avoids the validator
   * scores every traveller against. Sent in the body rather than read from the
   * `trips` table by the validator, which owns no trip schema — the orchestrator
   * already holds the brief in the workflow context.
   */
  async callValidatorAgent(
    tripId: string,
    round: number,
    proposal: Record<string, unknown>,
    groupPreferences?: { mustHaves: string[]; avoids: string[] },
    /** Finance/logistics compliance, blended with persona fit into the score
     * FINAL_VALIDATION gates on. Omitted → persona-only scoring, as before. */
    compliance?: ValidatorComplianceInput,
    constraints?: { budgetTotal?: number; travellerCount?: number; durationDays?: number },
  ): Promise<AgentCallResult> {
    return this.post<AgentCallResult>('validator', '/', {
      tripId, round, proposal, groupPreferences, compliance, constraints,
    });
  }

  // ── WorkflowEngine v2 methods ──────────────────────────────────────────────

  async callLogisticsPlan(
    tripId: string,
    destinations: Array<{ city: string; country: string; nights: number }>,
    dateInput: DateInput | null,
    transportPreference: TransportMode,
    budgetTotal: number,
    budgetCurrency: string,
    groupSize: number,
  ): Promise<RouteGraph> {
    const resp = await this.post<{ routeGraph: RouteGraph }>(
      'logistics',
      '/plan',
      { tripId, destinations, dateInput, transportPreference, budgetTotal, budgetCurrency, groupSize },
    );
    return resp.routeGraph;
  }

  async callLogisticsRestrictions(
    tripId: string,
    itinerary: Array<Record<string, unknown>>,
    region: string | null,
    dateInput: DateInput | null,
  ): Promise<RestrictionWarning[]> {
    const resp = await this.post<{ warnings: RestrictionWarning[] }>(
      'logistics',
      '/restrictions',
      { tripId, itinerary, region: region ?? 'unknown', dateInput },
    );
    return resp.warnings;
  }

  async callLogisticsWeatherAssessment(
    tripId: string,
    round: number,
    itinerary: Array<Record<string, unknown>>,
    region: string | null,
    dateInput: DateInput | null,
    restrictionWarnings?: RestrictionWarning[],
  ): Promise<AgentCallResult> {
    const start = Date.now();
    const resp = await this.post<{ assessment: AgentEventLike }>(
      'logistics',
      '/weather-assessment',
      { tripId, round, itinerary, region: region ?? 'unknown', dateInput, restrictionWarnings },
    );
    return toAgentCallResult(resp.assessment, Date.now() - start);
  }

  async callFinanceEstimate(
    tripId: string,
    routeGraph: RouteGraph,
    budgetTotal: number,
    budgetCurrency: string,
    groupSize: number,
  ): Promise<BudgetPlan> {
    const resp = await this.post<{ budgetPlan: BudgetPlan }>(
      'finance',
      '/estimate',
      { tripId, routeGraph, budgetTotal, budgetCurrency, groupSize },
    );
    return resp.budgetPlan;
  }

  async callPreferenceAgentSlots(
    tripId: string,
    round: number,
    slots: TouristSlotInput[],
  ): Promise<AgentCallResult[]> {
    const start = Date.now();
    const resp = await this.post<{ proposals: AgentEventLike[] }>(
      'preference-agent',
      '/propose-slots',
      { tripId, round, slots },
    );
    return (resp.proposals ?? []).map((p) => toAgentCallResult(p, Date.now() - start));
  }

  async callOrchestratorMerge(
    tripId: string,
    round: number,
    routeGraph: RouteGraph,
    touristOutputs: Record<string, unknown>,
    budgetPlan: BudgetPlan,
    context: string,
    targetCity: string,
    preferences: GroupPreferences,
  ): Promise<AgentCallResult> {
    const start = Date.now();
    const resp = await this.post<{ merged: AgentEventLike }>(
      'orchestrator-agent',
      '/merge',
      { tripId, round, routeGraph, touristOutputs, budgetPlan, context, targetCity, preferences },
    );
    return toAgentCallResult(resp.merged, Date.now() - start);
  }

  /**
   * Asks the orchestrator-agent for a targeted edit list that brings an
   * over-budget itinerary down to `targetTotal` (budget × tolerance). The
   * edits are applied deterministically by the WorkflowEngine — the agent
   * never returns a rewritten itinerary.
   */
  async callOrchestratorRepair(
    tripId: string,
    round: number,
    itinerary: Array<Record<string, unknown>>,
    accommodation: Array<Record<string, unknown>>,
    financeFeedback: FinanceFeedback,
    budgetTotal: number,
    budgetCurrency: string,
    groupSize: number,
    targetTotal: number,
  ): Promise<AgentCallResult> {
    const start = Date.now();
    const resp = await this.post<{ repair: AgentEventLike }>(
      'orchestrator-agent',
      '/repair',
      { tripId, round, itinerary, accommodation, financeFeedback, budgetTotal, budgetCurrency, groupSize, targetTotal },
    );
    return toAgentCallResult(resp.repair, Date.now() - start);
  }

  /**
   * Overlays real pricing (attraction DB, Google Places restaurant estimates,
   * hotel lookups) onto the merged itinerary's cost fields, which otherwise
   * only ever carry the merge LLM's own unlabelled guess.
   */
  async callLogisticsPricingOverlay(
    tripId: string,
    itinerary: Array<Record<string, unknown>>,
    accommodation: Array<Record<string, unknown>>,
    region: string | null,
    dateInput: DateInput | null,
  ): Promise<{ itinerary: Array<Record<string, unknown>>; accommodation: Array<Record<string, unknown>>; repricedCount: number }> {
    return this.post('logistics', '/pricing-overlay', {
      tripId, itinerary, accommodation, region: region ?? 'unknown', dateInput,
    });
  }

  /**
   * Resolves how to get from each day's base city to each activity's venue —
   * day-trip round-trip legs (e.g. Sintra from a Lisbon base) or local
   * drive/transit/walk candidates, depending on distance.
   */
  async callLogisticsLocalTransport(
    tripId: string,
    itinerary: Array<Record<string, unknown>>,
    dateInput: DateInput | null,
    preferredTransport: TransportMode,
  ): Promise<{ itinerary: Array<Record<string, unknown>>; satelliteLegs: TransportLeg[] }> {
    return this.post('logistics', '/local-transport', {
      tripId, itinerary, dateInput, transportPreference: preferredTransport,
    });
  }

  // ── End WorkflowEngine v2 methods ──────────────────────────────────────────
}

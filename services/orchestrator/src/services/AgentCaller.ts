import { BaseService } from '@itinera/shared';
import type { DateInput, TransportMode, RouteGraph, BudgetPlan, TouristSlotInput, RestrictionWarning, GroupPreferences } from '@itinera/shared';
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

  async callValidatorAgent(
    tripId: string,
    round: number,
    proposal: Record<string, unknown>,
  ): Promise<AgentCallResult> {
    return this.post<AgentCallResult>('validator', '/', { tripId, round, proposal });
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

  // ── End WorkflowEngine v2 methods ──────────────────────────────────────────
}

import { BaseService } from '@itinera/shared';
import type { DateInput, TransportMode } from '@itinera/shared';
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

  async callPreferenceAgent(
    tripId: string,
    agentName: string,
    round: number,
    context = '',
  ): Promise<AgentCallResult> {
    const start = Date.now();
    const resp = await this.post<{ proposals: AgentEventLike[] }>(
      'preference-agent',
      '/propose',
      { tripId, round, agents: [agentName], context },
    );
    return toAgentCallResult(resp.proposals[0], Date.now() - start);
  }

  async callOrchestratorAgent(
    tripId: string,
    round: number,
    proposals: Record<string, unknown>[],
  ): Promise<AgentCallResult> {
    const start = Date.now();
    const resp = await this.post<{ analysis: AgentEventLike }>(
      'orchestrator-agent',
      '/analyze',
      { tripId, round, proposals },
    );
    return toAgentCallResult(resp.analysis, Date.now() - start);
  }

  async callOrchestratorPropose(
    tripId: string,
    round: number,
    conflicts: Record<string, unknown>,
    context = '',
  ): Promise<AgentCallResult> {
    const start = Date.now();
    const resp = await this.post<{ compromise: AgentEventLike }>(
      'orchestrator-agent',
      '/propose',
      { tripId, round, conflicts, context },
    );
    return toAgentCallResult(resp.compromise, Date.now() - start);
  }

  async callOrchestratorRefine(
    tripId: string,
    round: number,
    proposal: Record<string, unknown>,
    feedback: string,
    context = '',
  ): Promise<AgentCallResult> {
    const start = Date.now();
    const resp = await this.post<{ refined: AgentEventLike }>(
      'orchestrator-agent',
      '/refine',
      { tripId, round, proposal, feedback, context },
    );
    return toAgentCallResult(resp.refined, Date.now() - start);
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
        dateInput: tripContext?.dateInput ?? null,
      },
    );
    return toAgentCallResult(resp.review, Date.now() - start);
  }

  async callLogisticsAgent(
    tripId: string,
    round: number,
    proposal: Record<string, unknown>,
    tripContext?: AgentTripContext,
  ): Promise<AgentCallResult> {
    const start = Date.now();
    const resp = await this.post<{ validation: AgentEventLike }>(
      'logistics',
      '/validate',
      {
        tripId,
        round,
        proposal,
        region: tripContext?.region ?? 'unknown',
        dateInput: tripContext?.dateInput ?? null,
        transportPreference: tripContext?.transportPreference ?? 'best',
      },
    );
    return toAgentCallResult(resp.validation, Date.now() - start);
  }

  async callValidatorAgent(
    tripId: string,
    round: number,
    proposal: Record<string, unknown>,
  ): Promise<AgentCallResult> {
    return this.post<AgentCallResult>('validator', '/', { tripId, round, proposal });
  }
}

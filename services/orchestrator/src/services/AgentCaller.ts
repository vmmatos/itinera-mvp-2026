import { BaseService } from '@itinera/shared';
import { config } from '@/config';

export interface AgentCallResult {
  content: Record<string, unknown>;
  reasoning?: string;
  latencyMs: number;
  tokensUsed: number;
}

const SERVICE_URLS: Record<string, string> = {
  'preference-agent': config.PREFERENCE_AGENT_URL,
  'orchestrator-agent': config.ORCHESTRATOR_AGENT_URL,
  finance: config.FINANCE_AGENT_URL,
  logistics: config.LOGISTICS_AGENT_URL,
  validator: config.VALIDATOR_URL,
};

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
      headers: { 'Content-Type': 'application/json' },
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
  ): Promise<AgentCallResult> {
    return this.post<AgentCallResult>('preference-agent', '/api/v1/preferences/negotiate', {
      tripId,
      agentName,
      round,
    });
  }

  async callOrchestratorAgent(
    tripId: string,
    round: number,
    proposals: Record<string, unknown>[],
  ): Promise<AgentCallResult> {
    return this.post<AgentCallResult>('orchestrator-agent', '/api/v1/orchestrate/analyze', {
      tripId,
      round,
      proposals,
    });
  }

  async callFinanceAgent(
    tripId: string,
    round: number,
    proposal: Record<string, unknown>,
  ): Promise<AgentCallResult> {
    return this.post<AgentCallResult>('finance', '/api/v1/finance/evaluate', {
      tripId,
      round,
      proposal,
    });
  }

  async callLogisticsAgent(
    tripId: string,
    round: number,
    proposal: Record<string, unknown>,
  ): Promise<AgentCallResult> {
    return this.post<AgentCallResult>('logistics', '/api/v1/logistics/evaluate', {
      tripId,
      round,
      proposal,
    });
  }

  async callValidatorAgent(
    tripId: string,
    round: number,
    proposal: Record<string, unknown>,
  ): Promise<AgentCallResult> {
    return this.post<AgentCallResult>('validator', '/api/v1/validate', {
      tripId,
      round,
      proposal,
    });
  }
}

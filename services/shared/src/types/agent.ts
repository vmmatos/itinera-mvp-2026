export interface AgentEvent {
  tripId: string;
  type: string;
  agent: string;
  round: number;
  timestamp: string;
  content: unknown;
  reasoning?: string;
  metrics?: {
    latencyMs: number;
    tokensUsed: number;
  };
}

export type AgentName =
  | 'alice'
  | 'bob'
  | 'carlos'
  | 'diana'
  | 'orchestrator'
  | 'finance'
  | 'logistics'
  | 'validator';

export type AgentAction = 'propose' | 'refine' | 'accept' | 'reject' | 'score' | 'notification';

export function buildRoutingKey(agent: AgentName, action: AgentAction): string {
  return `agent.${agent}.${action}`;
}

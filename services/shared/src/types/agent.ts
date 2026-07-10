import { z } from 'zod';

export const AgentEventSchema = z.object({
  tripId: z.string(),
  type: z.string(),
  agent: z.string(),
  round: z.number().int(),
  timestamp: z.string(),
  content: z.unknown(),
  reasoning: z.string().optional(),
  metrics: z
    .object({
      latencyMs: z.number(),
      tokensUsed: z.number(),
    })
    .optional(),
});

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

export type AgentAction =
  | 'propose'
  | 'refine'
  | 'accept'
  | 'reject'
  | 'score'
  | 'notification'
  | 'plan'
  | 'estimate'
  | 'merge'
  | 'decision';

export function buildRoutingKey(agent: AgentName, action: AgentAction): string {
  return `agent.${agent}.${action}`;
}

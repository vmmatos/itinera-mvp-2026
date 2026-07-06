import 'dotenv/config';
import { z } from 'zod';

const EnvSchema = z.object({
  PORT: z.coerce.number().default(3001),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.string().default('info'),
  POSTGRES_HOST: z.string().default('localhost'),
  POSTGRES_PORT: z.coerce.number().default(5432),
  POSTGRES_DB: z.string().default('itinera'),
  POSTGRES_USER: z.string().default('itinera'),
  POSTGRES_PASSWORD: z.string().min(1),
  RABBITMQ_HOST: z.string().default('localhost'),
  RABBITMQ_PORT: z.coerce.number().default(5672),
  RABBITMQ_DEFAULT_USER: z.string().default('itinera'),
  RABBITMQ_DEFAULT_PASS: z.string().min(1),
  RABBITMQ_EXCHANGE: z.string().default('agent.events'),
  JWT_SECRET: z.string().min(1),
  JWT_ISSUER: z.string().optional(),
  PREFERENCE_AGENT_URL: z.string().default('http://preference-agent:3002'),
  ORCHESTRATOR_AGENT_URL: z.string().default('http://orchestrator-agent:3003'),
  FINANCE_AGENT_URL: z.string().default('http://finance-agent:3004'),
  LOGISTICS_AGENT_URL: z.string().default('http://logistics-agent:3005'),
  VALIDATOR_URL: z.string().default('http://validator:3006'),
  // Max negotiation rounds before forced convergence (card #79).
  MAX_ROUNDS: z.coerce.number().int().min(1).default(6),
  // Orchestration engine: v1 = NegotiationLoop (rounds), v2 = WorkflowEngine (logistics-first).
  WORKFLOW_ENGINE: z.enum(['v1', 'v2']).default('v2'),
  // Anthropic API — used by DestinationParser LLM fallback.
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default('claude-sonnet-4-20250514'),
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment variables:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = parsed.data;

export function getRabbitMQUrl(): string {
  const { RABBITMQ_DEFAULT_USER, RABBITMQ_DEFAULT_PASS, RABBITMQ_HOST, RABBITMQ_PORT } = config;
  return `amqp://${RABBITMQ_DEFAULT_USER}:${RABBITMQ_DEFAULT_PASS}@${RABBITMQ_HOST}:${RABBITMQ_PORT}`;
}

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
  // Anthropic API — used by DestinationParser LLM fallback.
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default('claude-sonnet-4-20250514'),
  // Above Node/undici's own default socket timeout (5 min) — long merge-city
  // and repair calls (up to ~6 min observed on real trips) were hitting that
  // default and throwing a generic "TypeError: fetch failed" with no
  // explicit timeout ever configured. This makes the ceiling explicit and
  // gives AgentCaller a real timer to abort on instead of relying on it.
  AGENT_CALL_TIMEOUT_MS: z.coerce.number().int().positive().default(360000),
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

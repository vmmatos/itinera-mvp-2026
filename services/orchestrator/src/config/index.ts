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
  // Master switch for DestinationParser's country→cities expansion (a bare
  // "Japan" destination becomes a real Tokyo→Kyoto→Osaka route). Off = the old
  // behaviour where the country name is used verbatim as the single "city".
  // NOT z.coerce.boolean(): that is JS Boolean(str), so "false" → true.
  DESTINATION_EXPANSION_ENABLED: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
  // Return fixture cities instead of calling Anthropic, so dev without an
  // ANTHROPIC_API_KEY still gets a real city route. Same enum pattern.
  DESTINATION_EXPANSION_MOCK: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  // Above Node/undici's own default socket timeout (5 min) — long merge-city
  // and repair calls (up to ~6 min observed on real trips) were hitting that
  // default and throwing a generic "TypeError: fetch failed" with no
  // explicit timeout ever configured. This makes the ceiling explicit and
  // gives AgentCaller a real timer to abort on instead of relying on it.
  AGENT_CALL_TIMEOUT_MS: z.coerce.number().int().positive().default(360000),
  // Per-module retry budget for the workflow state machine.
  WORKFLOW_MAX_RETRIES: z.coerce.number().int().min(0).max(10).default(2),
  // Must match the finance-agent's own BUDGET_TOLERANCE_PCT — used here to
  // compute the repair target (budget × (1 + pct/100)).
  BUDGET_TOLERANCE_PCT: z.coerce.number().min(0).max(50).default(10),
  // Temporary beta-launch guardrail: caps trips-per-user (excluding cancelled) so
  // testers don't burn Anthropic token / SerpAPI quota unbounded. Not a real
  // billing/plan limit — remove this whole check post-beta.
  MAX_TRIPS_PER_USER: z.coerce.number().int().min(1).max(100).default(3),
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

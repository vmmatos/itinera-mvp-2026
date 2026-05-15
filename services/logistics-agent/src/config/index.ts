import 'dotenv/config';
import { z } from 'zod';

const EnvSchema = z.object({
  PORT: z.coerce.number().default(3005),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.string().default('info'),
  ANTHROPIC_API_KEY: z.string().min(1),
  ANTHROPIC_MODEL: z.string().default('claude-sonnet-4-20250514'),
  POSTGRES_HOST: z.string().default('localhost'),
  POSTGRES_PORT: z.coerce.number().default(5432),
  POSTGRES_DB: z.string().default('itinera'),
  POSTGRES_USER: z.string().default('itinera'),
  POSTGRES_PASSWORD: z.string().min(1),
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().default(6379),
  RABBITMQ_HOST: z.string().default('localhost'),
  RABBITMQ_PORT: z.coerce.number().default(5672),
  RABBITMQ_DEFAULT_USER: z.string().default('itinera'),
  RABBITMQ_DEFAULT_PASS: z.string().min(1),
  RABBITMQ_EXCHANGE: z.string().default('agent.events'),
  JWT_SECRET: z.string().min(1),
  JWT_ISSUER: z.string().optional(),
  CACHE_TTL_SECONDS: z.coerce.number().default(3600),
  WEATHER_CACHE_TTL_SECONDS: z.coerce.number().default(1800),
  ATTRACTIONS_CACHE_TTL_SECONDS: z.coerce.number().default(86400),
  OPENWEATHERMAP_API_KEY: z.string().min(1),
  GOOGLE_PLACES_API_KEY: z.string().min(1),
  GOOGLE_MAPS_API_KEY: z.string().min(1),
  GOOGLE_MAPS_BASE_URL: z.string().default('https://maps.googleapis.com/maps/api'),
  GOOGLE_PLACES_BASE_URL: z.string().default('https://places.googleapis.com/v1'),
  OPENWEATHERMAP_BASE_URL: z.string().default('https://api.openweathermap.org'),
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

export function getRedisUrl(): string {
  return `redis://${config.REDIS_HOST}:${config.REDIS_PORT}`;
}

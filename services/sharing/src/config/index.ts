import 'dotenv/config'
import { z } from 'zod'

const EnvSchema = z.object({
  PORT: z.coerce.number().default(3008),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.string().default('info'),
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().default(6379),
  JWT_SECRET: z.string().min(1),
  JWT_ISSUER: z.string().optional(),
  SHARE_LINK_TTL_SECONDS: z.coerce.number().default(604800),
  SHARING_BASE_URL: z.string().default('http://localhost:3008'),
  PUPPETEER_EXECUTABLE_PATH: z.string().optional(),
})

const parsed = EnvSchema.safeParse(process.env)

if (!parsed.success) {
  console.error('Invalid environment variables:', parsed.error.flatten().fieldErrors)
  process.exit(1)
}

export const config = parsed.data
export type Config = z.infer<typeof EnvSchema>

export function getRedisUrl(): string {
  return `redis://${config.REDIS_HOST}:${config.REDIS_PORT}`
}

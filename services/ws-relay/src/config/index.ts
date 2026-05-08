import { z } from 'zod'

const ConfigSchema = z.object({
  PORT: z.string().default('3009').transform(Number),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.string().default('info'),
  RABBITMQ_HOST: z.string(),
  RABBITMQ_PORT: z.string().default('5672').transform(Number),
  RABBITMQ_DEFAULT_USER: z.string(),
  RABBITMQ_DEFAULT_PASS: z.string(),
  JWT_SECRET: z.string(),
  JWT_ISSUER: z.string().default('itinera'),
})

export const config = ConfigSchema.parse(process.env)
export type Config = z.infer<typeof ConfigSchema>

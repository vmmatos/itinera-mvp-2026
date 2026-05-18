import 'dotenv/config'
import { z } from 'zod'

const EnvSchema = z.object({
  PORT: z.coerce.number().default(3007),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.string().default('info'),
  RABBITMQ_HOST: z.string().default('localhost'),
  RABBITMQ_PORT: z.coerce.number().default(5672),
  RABBITMQ_DEFAULT_USER: z.string().default('itinera'),
  RABBITMQ_DEFAULT_PASS: z.string().min(1),
  JWT_SECRET: z.string().min(1),
  JWT_ISSUER: z.string().optional(),
  SENDGRID_ENABLED: z
    .string()
    .transform((v) => v === 'true')
    .default('false'),
  SENDGRID_API_KEY: z.string().optional(),
  SMTP_HOST: z.string().default('mailhog'),
  SMTP_PORT: z.coerce.number().default(1025),
  FCM_ENABLED: z
    .string()
    .transform((v) => v === 'true')
    .default('false'),
  TWILIO_ENABLED: z
    .string()
    .transform((v) => v === 'true')
    .default('false'),
  NOTIFICATION_FROM_EMAIL: z.string().email().default('noreply@itinera.dev'),
  NOTIFICATION_FROM_NAME: z.string().default('Itinera'),
})

const parsed = EnvSchema.safeParse(process.env)
if (!parsed.success) {
  console.error('Invalid environment variables:', parsed.error.flatten().fieldErrors)
  process.exit(1)
}

export const config = parsed.data
export type Config = z.infer<typeof EnvSchema>

export function getRabbitMQUrl(): string {
  const { RABBITMQ_DEFAULT_USER, RABBITMQ_DEFAULT_PASS, RABBITMQ_HOST, RABBITMQ_PORT } = config
  return `amqp://${RABBITMQ_DEFAULT_USER}:${RABBITMQ_DEFAULT_PASS}@${RABBITMQ_HOST}:${RABBITMQ_PORT}`
}

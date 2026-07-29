import 'dotenv/config'
import express from 'express'
import helmet from 'helmet'
import { requestLogger, errorHandler, authMiddleware, createLogger } from '@itinera/shared'
import { config, getRabbitMQUrl } from '@/config'
import { createEmailTransport } from '@/services/EmailService'
import { EmailConsumer } from '@/services/EmailConsumer'
import { createHealthRouter } from '@/routes/health'
import { createEmailRouter } from '@/routes/email'

const logger = createLogger('notification')
const app = express()

const transport = createEmailTransport(config)
const consumer = new EmailConsumer(getRabbitMQUrl(), transport, config)

app.use(helmet())
app.use(requestLogger)
app.use(express.json({ limit: '10mb' }))
app.use(createHealthRouter(consumer))
app.use('/api/v1/email', authMiddleware, createEmailRouter(transport, config))
app.use(errorHandler)

async function start(): Promise<void> {
  await consumer.connect()
  await consumer.consume('notification.email')

  const server = app.listen(config.PORT, () => {
    logger.info('notification started', { port: config.PORT })
  })

  const shutdown = async (): Promise<void> => {
    logger.info('Shutting down notification')
    await consumer.close()
    server.close(() => {
      logger.info('notification stopped')
      process.exit(0)
    })
  }

  process.on('SIGTERM', () => {
    void shutdown()
  })
  process.on('SIGINT', () => {
    void shutdown()
  })
}

async function startWithRetry(): Promise<void> {
  const RETRY_DELAY_MS = 5000
  for (let attempt = 1; ; attempt++) {
    try {
      await start()
      return
    } catch (err: unknown) {
      logger.warn('Failed to start notification, retrying...', { attempt, error: String(err) })
      await new Promise<void>((res) => setTimeout(res, RETRY_DELAY_MS))
    }
  }
}

void startWithRetry()

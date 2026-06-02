import 'dotenv/config'
import express from 'express'
import helmet from 'helmet'
import { requestLogger, errorHandler, createLogger } from '@itinera/shared'
import { config, getRabbitMQUrl } from '@/config'
import { createEmailTransport } from '@/services/EmailService'
import { EmailConsumer } from '@/services/EmailConsumer'
import { createHealthRouter } from '@/routes/health'

const logger = createLogger('notification')
const app = express()

const transport = createEmailTransport(config)
const consumer = new EmailConsumer(getRabbitMQUrl(), transport, config)

app.use(helmet())
app.use(requestLogger)
app.use(createHealthRouter(consumer))
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
  const MAX_ATTEMPTS = 12
  const RETRY_DELAY_MS = 5000
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      await start()
      return
    } catch (err: unknown) {
      if (attempt === MAX_ATTEMPTS) {
        logger.error('Failed to start notification, giving up', { error: String(err) })
        process.exit(1)
      }
      logger.warn('Failed to start notification, retrying...', { attempt, error: String(err) })
      await new Promise<void>((res) => setTimeout(res, RETRY_DELAY_MS))
    }
  }
}

void startWithRetry()

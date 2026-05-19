import 'dotenv/config'
import express from 'express'
import helmet from 'helmet'
import { requestLogger, errorHandler, createLogger } from '@itinera/shared'
import type { AgentEvent } from '@itinera/shared'
import { config } from '@/config'
import { SSEManager } from '@/services/SSEManager'
import { RabbitMQConsumer } from '@/services/RabbitMQConsumer'
import { createHealthRouter } from '@/routes/health'
import { createStreamRouter } from '@/routes/stream'

const logger = createLogger('ws-relay')
const app = express()
const sseManager = new SSEManager()
const rabbitUrl = `amqp://${config.RABBITMQ_DEFAULT_USER}:${config.RABBITMQ_DEFAULT_PASS}@${config.RABBITMQ_HOST}:${config.RABBITMQ_PORT}`
const consumer = new RabbitMQConsumer(rabbitUrl)

app.use(helmet())
app.use(requestLogger)
app.use(createHealthRouter(consumer, sseManager))
app.use(createStreamRouter(sseManager))
app.use(errorHandler)

async function start(): Promise<void> {
  await consumer.connect()
  await consumer.consume('admin.realtime', (event: AgentEvent) => {
    const eventType = event.type.split('.')[0] ?? 'agent'
    if (event.tripId) {
      sseManager.broadcastToTrip(event.tripId, event, eventType)
    } else {
      sseManager.broadcast(event, eventType)
    }
  })

  const server = app.listen(config.PORT, () => {
    logger.info('ws-relay started', { port: config.PORT })
  })

  const shutdown = async (): Promise<void> => {
    logger.info('Shutting down ws-relay')
    sseManager.closeAll()
    await consumer.close()
    server.close(() => {
      logger.info('ws-relay stopped')
      process.exit(0)
    })
  }

  process.on('SIGTERM', () => { void shutdown() })
  process.on('SIGINT', () => { void shutdown() })
}

start().catch((err: unknown) => {
  logger.error('Failed to start ws-relay', { error: String(err) })
  process.exit(1)
})

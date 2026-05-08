import { Router } from 'express'
import type { Request, Response } from 'express'
import type { HealthResponse, ReadyResponse } from '@itinera/shared'
import type { RabbitMQConsumer } from '@/services/RabbitMQConsumer'
import type { SSEManager } from '@/services/SSEManager'

export function createHealthRouter(consumer: RabbitMQConsumer, sseManager: SSEManager): Router {
  const router = Router()

  router.get('/health', (_req: Request, res: Response<HealthResponse>) => {
    res.json({ status: 'ok', service: 'ws-relay', timestamp: new Date().toISOString() })
  })

  router.get('/ready', (_req: Request, res: Response<ReadyResponse>) => {
    const rabbitmq = consumer.isConnected()
    const ready = rabbitmq
    res.status(ready ? 200 : 503).json({
      status: ready ? 'ready' : 'not_ready',
      service: 'ws-relay',
      timestamp: new Date().toISOString(),
      checks: { rabbitmq, clients: sseManager.clientCount() >= 0 },
    })
  })

  return router
}

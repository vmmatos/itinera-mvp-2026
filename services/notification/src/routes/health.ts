import { Router } from 'express'
import type { Request, Response } from 'express'
import type { HealthResponse, ReadyResponse } from '@itinera/shared'
import type { EmailConsumer } from '@/services/EmailConsumer'

export function createHealthRouter(consumer: EmailConsumer): Router {
  const router = Router()

  router.get('/health', (_req: Request, res: Response<HealthResponse>) => {
    res.json({ status: 'ok', service: 'notification', timestamp: new Date().toISOString() })
  })

  router.get('/ready', (_req: Request, res: Response<ReadyResponse>) => {
    const rabbitmq = consumer.isConnected()
    res.status(rabbitmq ? 200 : 503).json({
      status: rabbitmq ? 'ready' : 'not_ready',
      service: 'notification',
      timestamp: new Date().toISOString(),
      checks: { rabbitmq },
    })
  })

  return router
}

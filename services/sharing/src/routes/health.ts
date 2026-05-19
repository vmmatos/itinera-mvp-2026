import { Router } from 'express'
import type { Response } from 'express'
import type { HealthResponse, ReadyResponse } from '@itinera/shared'
import type { RedisService } from '@/services/RedisService'

export function createHealthRouter(redis: RedisService): Router {
  const router = Router()

  router.get('/health', (_req, res: Response<HealthResponse>) => {
    res.json({ status: 'ok', service: 'sharing', timestamp: new Date().toISOString() })
  })

  router.get('/ready', (_req, res: Response<ReadyResponse>) => {
    const cache = redis.isConnected()
    res.status(cache ? 200 : 503).json({
      status: cache ? 'ready' : 'not_ready',
      service: 'sharing',
      timestamp: new Date().toISOString(),
      checks: { redis: cache },
    })
  })

  return router
}

import { createHealthRouter as createRouter } from '@itinera/shared'
import type { Router } from 'express'
import type { RedisService } from '@/services/RedisService'

export function createHealthRouter(redis: RedisService): Router {
  return createRouter('sharing', {
    redis: () => redis.isConnected(),
  })
}

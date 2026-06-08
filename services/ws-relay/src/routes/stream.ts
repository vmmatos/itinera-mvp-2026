import { Router } from 'express'
import type { Request, Response, NextFunction } from 'express'
import { authMiddleware, createLogger } from '@itinera/shared'
import type { AuthenticatedRequest } from '@itinera/shared'
import type { SSEManager } from '@/services/SSEManager'

const logger = createLogger('ws-relay')

export function createStreamRouter(sseManager: SSEManager): Router {
  const router = Router()

  router.get(
    '/stream',
    authMiddleware,
    (req: Request, res: Response, _next: NextFunction) => {
      const clientId = crypto.randomUUID()
      const tripId = typeof req.query['tripId'] === 'string' ? req.query['tripId'] : undefined
      const roleParam = typeof req.query['role'] === 'string' ? req.query['role'] : undefined
      const user = (req as AuthenticatedRequest).user

      if (roleParam === 'admin' && user.role !== 'admin') {
        res.status(403).json({ error: 'Forbidden' })
        return
      }

      res.setHeader('Content-Type', 'text/event-stream')
      res.setHeader('Cache-Control', 'no-cache')
      res.setHeader('Connection', 'keep-alive')
      res.setHeader('X-Accel-Buffering', 'no')
      res.flushHeaders()

      sseManager.addClient(clientId, res, tripId)
      logger.info('SSE stream opened', { clientId, tripId, userId: user.sub })

      req.on('close', () => {
        sseManager.removeClient(clientId)
        logger.info('SSE stream closed', { clientId })
      })
    },
  )

  return router
}

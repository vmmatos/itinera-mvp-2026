import { Router } from 'express'
import type { Request, Response, NextFunction } from 'express'
import { ok } from '@itinera/shared'
import type { ShareLinkGenerator } from '@/services/ShareLinkGenerator'
import type { GetShareResponse } from '@/types/sharing'

export function createPublicShareRouter(generator: ShareLinkGenerator): Router {
  const router = Router()

  router.get('/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await generator.resolve(req.params['id'] as string)
      res.json(ok<GetShareResponse>(result))
    } catch (err) {
      next(err)
    }
  })

  return router
}

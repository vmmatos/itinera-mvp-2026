import { Router } from 'express'
import type { Request, Response, NextFunction } from 'express'
import { z } from 'zod'
import { ValidationError, ok } from '@itinera/shared'
import type { AuthenticatedRequest } from '@itinera/shared'
import type { ShareLinkGenerator } from '@/services/ShareLinkGenerator'
import type { GenerateShareResponse } from '@/types/sharing'

const ActivitySchema = z.object({
  name: z.string().min(1),
  category: z.string().optional(),
  location: z.string().optional(),
  duration: z.string().optional(),
  notes: z.string().optional(),
})

const DaySchema = z.object({
  day: z.number().int().positive(),
  date: z.string().optional(),
  activities: z.array(ActivitySchema),
  meals: z
    .array(
      z.object({
        type: z.string(),
        name: z.string(),
        location: z.string().optional(),
        rating: z.number().min(0).max(5).optional(),
      }),
    )
    .optional(),
  transport: z
    .array(
      z.object({
        from: z.string(),
        to: z.string(),
        mode: z.string(),
      }),
    )
    .optional(),
})

const ItinerarySchema = z.object({
  tripName: z.string().min(1),
  tripId: z.string(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  budgetTotal: z.number().positive().optional(),
  budgetCurrency: z.string().optional(),
  travellers: z.array(z.object({ name: z.string() })).optional(),
  days: z.array(DaySchema),
})

const GenerateShareSchema = z.object({
  tripId: z.string().uuid(),
  itinerary: ItinerarySchema,
})

export function createProtectedShareRouter(generator: ShareLinkGenerator): Router {
  const router = Router()

  router.post(
    '/generate',
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      const parsed = GenerateShareSchema.safeParse(req.body)
      if (!parsed.success) {
        next(new ValidationError(JSON.stringify(parsed.error.flatten().fieldErrors)))
        return
      }

      try {
        const authed = req as AuthenticatedRequest
        const result = await generator.generate(
          parsed.data.tripId,
          parsed.data.itinerary,
          authed.user.sub,
        )
        res.status(201).json(ok<GenerateShareResponse>(result))
      } catch (err) {
        next(err)
      }
    },
  )

  return router
}

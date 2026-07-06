import { Router } from 'express'
import type { Request, Response, NextFunction } from 'express'
import { z } from 'zod'
import { ValidationError } from '@itinera/shared'
import type { PDFGeneratorService } from '@/services/PDFGeneratorService'
import type { ItineraryData } from '@/types/sharing'

const ExportPDFSchema = z.object({
  tripId: z.string().uuid(),
  itinerary: z.object({
    tripName: z.string().min(1),
    tripId: z.string(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    budgetTotal: z.number().positive().optional(),
    budgetCurrency: z.string().optional(),
    travellers: z.array(z.object({ name: z.string() })).optional(),
    days: z.array(
      z.object({
        day: z.number().int().positive(),
        date: z.string().optional(),
        activities: z.array(
          z.object({
            name: z.string().min(1),
            category: z.string().optional(),
            location: z.string().optional(),
            duration: z.string().optional(),
            notes: z.string().optional(),
          }),
        ),
        meals: z
          .array(
            z.object({
              type: z.string(),
              name: z.string(),
              location: z.string().optional(),
            }),
          )
          .optional(),
        transport: z
          .array(
            z.object({
              from:            z.string(),
              to:              z.string(),
              mode:            z.string(),
              provider:        z.string().optional(),
              durationMinutes: z.number().optional(),
              priceEur:        z.number().optional(),
              departureTime:   z.string().optional(),
              arrivalTime:     z.string().optional(),
              displaySummary:  z.string().optional(),
              segments:        z.array(z.record(z.unknown())).optional(),
            }),
          )
          .optional(),
      }),
    ),
  }),
})

export function createExportRouter(pdfGenerator: PDFGeneratorService): Router {
  const router = Router()

  router.post('/pdf', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const parsed = ExportPDFSchema.safeParse(req.body)
    if (!parsed.success) {
      next(new ValidationError(JSON.stringify(parsed.error.flatten().fieldErrors)))
      return
    }

    try {
      const pdfBuffer = await pdfGenerator.generate(parsed.data.itinerary as ItineraryData)

      res.set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="itinerary-${parsed.data.tripId}.pdf"`,
        'Content-Length': pdfBuffer.length.toString(),
      })
      res.send(pdfBuffer)
    } catch (err) {
      next(err)
    }
  })

  return router
}

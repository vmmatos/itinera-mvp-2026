import { Router } from 'express'
import type { Request, Response, NextFunction } from 'express'
import { z } from 'zod'
import { ValidationError, ok } from '@itinera/shared'
import type { EmailTransport } from '@/services/EmailService'
import { renderItineraryPdf } from '@/templates'
import type { Config } from '@/config'

const SendItineraryPdfSchema = z.object({
  to: z.string().email(),
  tripName: z.string().min(1),
  firstName: z.string().min(1).optional(),
  filename: z.string().min(1),
  pdfBase64: z.string().min(1),
})

export function createEmailRouter(transport: EmailTransport, config: Config): Router {
  const router = Router()

  router.post(
    '/itinerary-pdf',
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      const parsed = SendItineraryPdfSchema.safeParse(req.body)
      if (!parsed.success) {
        next(new ValidationError(JSON.stringify(parsed.error.flatten().fieldErrors)))
        return
      }

      try {
        const { to, tripName, firstName, filename, pdfBase64 } = parsed.data
        const from = { email: config.NOTIFICATION_FROM_EMAIL, name: config.NOTIFICATION_FROM_NAME }
        const rendered = renderItineraryPdf({ firstName: firstName ?? 'there', tripName })
        await transport.send(to, from, rendered, [
          { filename, content: Buffer.from(pdfBase64, 'base64'), contentType: 'application/pdf' },
        ])
        res.json(ok({ sent: true }))
      } catch (err) {
        next(err)
      }
    },
  )

  return router
}

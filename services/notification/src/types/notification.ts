import { z } from 'zod'

export const NotificationEmailPayloadSchema = z.object({
  type: z.enum([
    'welcome',
    'itinerary-ready',
    'booking-reminder',
    'password-reset',
    'password-changed',
  ]),
  to: z.string().email(),
  data: z.record(z.unknown()),
})

export type NotificationEmailPayload = z.infer<typeof NotificationEmailPayloadSchema>

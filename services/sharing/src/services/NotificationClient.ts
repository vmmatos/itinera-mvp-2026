import jwt from 'jsonwebtoken'
import { createLogger } from '@itinera/shared'
import { config } from '@/config'

function buildServiceToken(): string {
  return jwt.sign(
    { sub: 'sharing', role: 'service', iss: config.JWT_ISSUER ?? 'itinera' },
    config.JWT_SECRET,
    { expiresIn: '5m' },
  )
}

export class NotificationClient {
  private readonly logger = createLogger('notification-client')

  async sendItineraryPdf(
    to: string,
    tripName: string,
    firstName: string,
    filename: string,
    pdfBuffer: Buffer,
  ): Promise<void> {
    const response = await fetch(`${config.NOTIFICATION_URL}/api/v1/email/itinerary-pdf`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${buildServiceToken()}`,
      },
      body: JSON.stringify({
        to,
        tripName,
        firstName,
        filename,
        pdfBase64: pdfBuffer.toString('base64'),
      }),
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`notification service returned ${response.status}: ${text}`)
    }

    this.logger.info('Itinerary PDF email requested', { to, tripName })
  }
}

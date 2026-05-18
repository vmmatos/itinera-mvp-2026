import { createLogger } from '@itinera/shared'
import type { Config } from '@/config'

export class SmsService {
  private readonly logger = createLogger('notification')

  constructor(private readonly config: Config) {}

  async send(to: string, body: string): Promise<void> {
    if (!this.config.TWILIO_ENABLED) {
      this.logger.warn('SmsService.send called but TWILIO_ENABLED=false — no-op', {
        to: to.slice(0, 4) + '…',
        bodyLength: body.length,
      })
      return
    }
    // TODO: implement Twilio SMS when TWILIO_ENABLED=true
    throw new Error('Twilio SMS not yet implemented')
  }
}

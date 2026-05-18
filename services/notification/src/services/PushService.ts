import { createLogger } from '@itinera/shared'
import type { Config } from '@/config'

export class PushService {
  private readonly logger = createLogger('notification')

  constructor(private readonly config: Config) {}

  async send(deviceToken: string, title: string, body: string): Promise<void> {
    if (!this.config.FCM_ENABLED) {
      this.logger.warn('PushService.send called but FCM_ENABLED=false — no-op', {
        deviceToken: deviceToken.slice(0, 8) + '…',
        title,
      })
      return
    }
    // TODO: implement FCM push when FCM_ENABLED=true
    void body
    throw new Error('FCM push not yet implemented')
  }
}

import amqplib from 'amqplib'
import type { ChannelModel, Channel, ConsumeMessage } from 'amqplib'
import { createLogger } from '@itinera/shared'
import { NotificationEmailPayloadSchema } from '@/types/notification'
import type { NotificationEmailPayload } from '@/types/notification'
import type { EmailTransport } from '@/services/EmailService'
import { renderWelcome, renderItineraryReady, renderBookingReminder } from '@/templates'
import type { RenderedEmail } from '@/templates'
import type { Config } from '@/config'

export class EmailConsumer {
  private connection: ChannelModel | null = null
  private channel: Channel | null = null
  private readonly logger = createLogger('notification')
  private reconnectAttempts = 0
  private readonly maxReconnectAttempts = 5
  private reconnecting = false
  private savedQueue = ''

  constructor(
    private readonly url: string,
    private readonly transport: EmailTransport,
    private readonly config: Config,
  ) {}

  async connect(): Promise<void> {
    const connection = await amqplib.connect(this.url)
    this.connection = connection
    this.channel = await connection.createChannel()
    await this.channel.prefetch(1)
    this.reconnectAttempts = 0
    this.reconnecting = false
    this.logger.info('RabbitMQ connected')

    connection.on('error', (err: Error) => {
      this.logger.error('RabbitMQ connection error', { error: err.message })
      void this.scheduleReconnect()
    })
    connection.on('close', () => {
      this.logger.warn('RabbitMQ connection closed')
      void this.scheduleReconnect()
    })
  }

  async consume(queue: string): Promise<void> {
    if (!this.channel) throw new Error('Not connected to RabbitMQ')
    this.savedQueue = queue

    await this.channel.consume(queue, (msg: ConsumeMessage | null) => {
      if (!msg) return
      void this.handleMessage(msg)
    })
    this.logger.info('Consuming queue', { queue })
  }

  isConnected(): boolean {
    return this.connection !== null && this.channel !== null
  }

  async close(): Promise<void> {
    try {
      await this.channel?.close()
    } catch {
      /* ignore */
    }
    try {
      await this.connection?.close()
    } catch {
      /* ignore */
    }
    this.channel = null
    this.connection = null
  }

  private async handleMessage(msg: ConsumeMessage): Promise<void> {
    let raw: unknown
    try {
      raw = JSON.parse(msg.content.toString()) as unknown
    } catch {
      this.logger.warn('Failed to parse message JSON — discarding')
      this.channel!.nack(msg, false, false)
      return
    }

    const result = NotificationEmailPayloadSchema.safeParse(raw)
    if (!result.success) {
      this.logger.warn('Invalid NotificationEmailPayload — discarding', {
        error: result.error.message,
        raw: JSON.stringify(raw).slice(0, 200),
      })
      this.channel!.nack(msg, false, false)
      return
    }

    try {
      await this.dispatch(result.data)
      this.channel!.ack(msg)
    } catch (err) {
      this.logger.error('Failed to send email', { error: String(err) })
      this.channel!.nack(msg, false, false)
    }
  }

  private async dispatch(payload: NotificationEmailPayload): Promise<void> {
    const from = {
      email: this.config.NOTIFICATION_FROM_EMAIL,
      name: this.config.NOTIFICATION_FROM_NAME,
    }

    let rendered: RenderedEmail
    switch (payload.type) {
      case 'welcome':
        rendered = renderWelcome(payload.data as unknown as Parameters<typeof renderWelcome>[0])
        break
      case 'itinerary-ready':
        rendered = renderItineraryReady(
          payload.data as unknown as Parameters<typeof renderItineraryReady>[0],
        )
        break
      case 'booking-reminder':
        rendered = renderBookingReminder(
          payload.data as unknown as Parameters<typeof renderBookingReminder>[0],
        )
        break
    }

    await this.transport.send(payload.to, from, rendered)
  }

  private async scheduleReconnect(): Promise<void> {
    if (this.reconnecting) return
    this.reconnecting = true
    this.channel = null
    this.connection = null

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.logger.error('RabbitMQ max reconnect attempts reached — exiting')
      process.exit(1)
    }

    const delay = Math.min(1000 * 2 ** this.reconnectAttempts, 30_000)
    this.reconnectAttempts++
    this.logger.info('Reconnecting RabbitMQ', {
      attempt: this.reconnectAttempts,
      delayMs: delay,
    })
    await new Promise<void>((resolve) => setTimeout(resolve, delay))

    await this.connect()
    if (this.savedQueue) {
      await this.consume(this.savedQueue)
    }
  }
}

import amqplib from 'amqplib'
import type { ChannelModel, Channel, ConsumeMessage } from 'amqplib'
import { createLogger, AgentEventSchema } from '@itinera/shared'
import type { AgentEvent } from '@itinera/shared'

type MessageHandler = (event: AgentEvent) => void

export class RabbitMQConsumer {
  private connection: ChannelModel | null = null
  private channel: Channel | null = null
  private readonly logger = createLogger('ws-relay')
  private reconnectAttempts = 0
  private savedHandler: MessageHandler | null = null
  private savedQueue = ''
  private reconnecting = false

  constructor(private readonly url: string) {}

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

  async consume(queue: string, handler: MessageHandler): Promise<void> {
    if (!this.channel) throw new Error('Not connected to RabbitMQ')
    this.savedHandler = handler
    this.savedQueue = queue
    await this.channel.consume(queue, (msg: ConsumeMessage | null) => {
      if (!msg) return
      try {
        const raw: unknown = JSON.parse(msg.content.toString())
        const result = AgentEventSchema.safeParse(raw)
        if (!result.success) {
          this.logger.warn('Invalid AgentEvent — discarding', {
            error: result.error.message,
            raw: JSON.stringify(raw).slice(0, 200),
          })
          this.channel!.nack(msg, false, false)
          return
        }
        handler(result.data as AgentEvent)
        this.channel!.ack(msg)
      } catch (err) {
        this.logger.error('Failed to process RabbitMQ message', { error: String(err) })
        this.channel!.nack(msg, false, false)
      }
    })
    this.logger.info('Consuming queue', { queue })
  }

  isConnected(): boolean {
    return this.connection !== null && this.channel !== null
  }

  async close(): Promise<void> {
    try { await this.channel?.close() } catch { /* ignore */ }
    try { await this.connection?.close() } catch { /* ignore */ }
    this.channel = null
    this.connection = null
  }

  private async scheduleReconnect(): Promise<void> {
    if (this.reconnecting) return
    this.reconnecting = true
    this.channel = null
    this.connection = null

    const delay = Math.min(1000 * 2 ** this.reconnectAttempts, 30_000)
    this.reconnectAttempts++
    this.logger.info('Reconnecting RabbitMQ', { attempt: this.reconnectAttempts, delayMs: delay })
    await new Promise<void>(resolve => setTimeout(resolve, delay))

    try {
      await this.connect()
      if (this.savedHandler && this.savedQueue) {
        await this.consume(this.savedQueue, this.savedHandler)
      }
    } catch (err) {
      this.logger.warn('RabbitMQ reconnect failed', { error: String(err) })
      this.reconnecting = false
      void this.scheduleReconnect()
    }
  }
}

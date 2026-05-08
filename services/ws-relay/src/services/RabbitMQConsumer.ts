import amqplib from 'amqplib'
import type { Connection, Channel, ConsumeMessage } from 'amqplib'
import { createLogger } from '@itinera/shared'
import type { AgentEvent } from '@itinera/shared'

type MessageHandler = (event: AgentEvent) => void

export class RabbitMQConsumer {
  private connection: Connection | null = null
  private channel: Channel | null = null
  private readonly logger = createLogger('ws-relay')
  private reconnectAttempts = 0
  private readonly maxReconnectAttempts = 5
  private savedHandler: MessageHandler | null = null
  private savedQueue = ''
  private reconnecting = false

  constructor(private readonly url: string) {}

  async connect(): Promise<void> {
    this.connection = await amqplib.connect(this.url)
    this.channel = await this.connection.createChannel()
    await this.channel.prefetch(1)
    this.reconnectAttempts = 0
    this.reconnecting = false
    this.logger.info('RabbitMQ connected')

    this.connection.on('error', (err: Error) => {
      this.logger.error('RabbitMQ connection error', { error: err.message })
      void this.scheduleReconnect()
    })
    this.connection.on('close', () => {
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
        const event = JSON.parse(msg.content.toString()) as AgentEvent
        handler(event)
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

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.logger.error('RabbitMQ max reconnect attempts reached — exiting')
      process.exit(1)
    }

    const delay = Math.min(1000 * 2 ** this.reconnectAttempts, 30_000)
    this.reconnectAttempts++
    this.logger.info('Reconnecting RabbitMQ', { attempt: this.reconnectAttempts, delayMs: delay })
    await new Promise<void>(resolve => setTimeout(resolve, delay))

    await this.connect()
    if (this.savedHandler && this.savedQueue) {
      await this.consume(this.savedQueue, this.savedHandler)
    }
  }
}

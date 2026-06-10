import amqplib from 'amqplib';
import type { ChannelModel, Channel } from 'amqplib';
import { BaseService } from '@itinera/shared';
import type { AgentEvent, AgentName, AgentAction } from '@itinera/shared';
import { buildRoutingKey } from '@itinera/shared';
import { config, getRabbitMQUrl } from '@/config';

export class EventPublisher extends BaseService {
  private connection: ChannelModel | null = null;
  private channel: Channel | null = null;
  private reconnecting = false;
  private reconnectAttempts = 0;
  private readonly maxReconnectAttempts = 10;

  constructor() {
    super('event-publisher');
  }

  async connect(): Promise<void> {
    const connection = await amqplib.connect(`${getRabbitMQUrl()}?heartbeat=60`);
    this.connection = connection;
    this.channel = await connection.createChannel();
    await this.channel.assertExchange(config.RABBITMQ_EXCHANGE, 'topic', { durable: true });

    // Reset only after fully successful connect
    this.reconnecting = false;
    this.reconnectAttempts = 0;

    connection.on('error', (err: Error) => {
      this.logger.error('RabbitMQ connection error', { error: err.message });
      void this.scheduleReconnect();
    });
    connection.on('close', () => {
      this.logger.warn('RabbitMQ connection closed');
      void this.scheduleReconnect();
    });

    this.logger.info('EventPublisher connected');
  }

  private async scheduleReconnect(): Promise<void> {
    if (this.reconnecting) return;
    this.reconnecting = true;
    this.connection = null;
    this.channel = null;

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.logger.error('RabbitMQ max reconnect attempts reached — will retry in 60s');
      this.reconnecting = false;
      this.reconnectAttempts = 0;
      await new Promise<void>(resolve => setTimeout(resolve, 60_000));
      void this.scheduleReconnect();
      return;
    }

    const delay = Math.min(1000 * 2 ** this.reconnectAttempts, 30_000);
    this.reconnectAttempts++;
    this.logger.info('Reconnecting RabbitMQ', { attempt: this.reconnectAttempts, delayMs: delay });
    await new Promise<void>(resolve => setTimeout(resolve, delay));

    try {
      await this.connect();
    } catch (err) {
      this.logger.error('RabbitMQ reconnect failed', { error: String(err) });
      this.reconnecting = false;
      void this.scheduleReconnect();
    }
  }

  async publish(agent: AgentName, action: AgentAction, event: AgentEvent): Promise<void> {
    if (!this.channel) {
      this.logger.warn('EventPublisher not connected — skipping', { agent, action });
      return;
    }
    const routingKey = buildRoutingKey(agent, action);
    const payload = Buffer.from(JSON.stringify(event));
    this.channel.publish(config.RABBITMQ_EXCHANGE, routingKey, payload, {
      persistent: true,
      contentType: 'application/json',
    });
    this.logger.debug('Event published', { routingKey, tripId: event.tripId });
  }

  async publishToExchange(exchange: string, routingKey: string, payload: unknown): Promise<void> {
    if (!this.channel) {
      this.logger.warn('EventPublisher not connected — skipping', { exchange, routingKey });
      return;
    }
    await this.channel.assertExchange(exchange, 'topic', { durable: true });
    this.channel.publish(exchange, routingKey, Buffer.from(JSON.stringify(payload)), {
      persistent: true,
      contentType: 'application/json',
    });
    this.logger.debug('Event published to exchange', { exchange, routingKey });
  }

  isConnected(): boolean {
    return this.connection !== null && this.channel !== null;
  }

  async close(): Promise<void> {
    try { await this.channel?.close(); } catch { /* ignore */ }
    try { await this.connection?.close(); } catch { /* ignore */ }
    this.channel = null;
    this.connection = null;
  }
}

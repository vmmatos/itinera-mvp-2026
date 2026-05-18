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

  constructor() {
    super('event-publisher');
  }

  async connect(): Promise<void> {
    this.reconnecting = false;
    const connection = await amqplib.connect(`${getRabbitMQUrl()}?heartbeat=60`);
    this.connection = connection;
    this.channel = await connection.createChannel();
    await this.channel.assertExchange(config.RABBITMQ_EXCHANGE, 'topic', { durable: true });

    connection.on('error', (err: Error) => {
      this.logger.error('RabbitMQ connection error', { error: err.message });
    });
    connection.on('close', () => {
      this.logger.warn('RabbitMQ connection closed');
      this.connection = null;
      this.channel = null;
      this.reconnecting = true;
      setTimeout(() => void this.connect(), 5000);
    });

    this.logger.info('EventPublisher connected');
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

  isConnected(): boolean {
    return this.reconnecting || (this.connection !== null && this.channel !== null);
  }

  async close(): Promise<void> {
    try { await this.channel?.close(); } catch { /* ignore */ }
    try { await this.connection?.close(); } catch { /* ignore */ }
    this.channel = null;
    this.connection = null;
  }
}

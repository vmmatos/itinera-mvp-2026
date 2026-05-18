import amqplib from 'amqplib';
import type { ChannelModel, Channel } from 'amqplib';
import { BaseService } from '@itinera/shared';
import type { AgentEvent } from '@itinera/shared';
import { config, getRabbitMQUrl } from '@/config';

export class RabbitMQPublisher extends BaseService {
  private connection: ChannelModel | null = null;
  private channel: Channel | null = null;

  constructor() {
    super('rabbitmq-publisher');
  }

  async connect(): Promise<void> {
    const connection = await amqplib.connect(getRabbitMQUrl());
    this.connection = connection;
    this.channel = await connection.createChannel();

    await this.channel.assertExchange(config.RABBITMQ_EXCHANGE, 'topic', { durable: true });

    connection.on('error', (err: Error) => {
      this.logger.error('RabbitMQ publisher connection error', { error: err.message });
    });
    connection.on('close', () => {
      this.logger.warn('RabbitMQ publisher connection closed');
      this.connection = null;
      this.channel = null;
    });

    this.logger.info('RabbitMQ publisher connected');
  }

  async publish(routingKey: string, event: AgentEvent): Promise<void> {
    if (!this.channel) {
      this.logger.warn('RabbitMQ publisher not connected — skipping publish', { routingKey });
      return;
    }

    const payload = Buffer.from(JSON.stringify(event));
    this.channel.publish(config.RABBITMQ_EXCHANGE, routingKey, payload, {
      persistent: true,
      contentType: 'application/json',
    });

    this.logger.debug('Event published', { routingKey, tripId: event.tripId });
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

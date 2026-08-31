import amqplib from 'amqplib';
import type { ChannelModel, Channel } from 'amqplib';
import { createLogger } from '@itinera/shared';

const NOTIFICATIONS_EXCHANGE = 'notifications';

/**
 * Shape consumed by the notification service's `EmailConsumer`
 * (`NotificationEmailPayloadSchema`). Kept as a local type so auth does not
 * depend on the notification package.
 */
export interface NotificationEmailPayload {
  type: 'password-reset' | 'password-changed';
  to: string;
  data: Record<string, unknown>;
}

/**
 * Publish-only RabbitMQ client for outbound transactional email.
 *
 * Best-effort by design: the auth service must keep serving logins even when
 * RabbitMQ is unreachable, so `connect()` failures and `publishEmail()` when
 * disconnected are logged, never thrown. A bounded exponential backoff retries
 * the connection; on exhaustion it gives up quietly (no `process.exit`).
 */
export class EmailPublisher {
  private connection: ChannelModel | null = null;
  private channel: Channel | null = null;
  private readonly logger = createLogger('auth');
  private reconnectAttempts = 0;
  private readonly maxReconnectAttempts = 5;
  private reconnecting = false;
  private closed = false;

  constructor(private readonly url: string) {}

  async connect(): Promise<void> {
    this.closed = false;
    const connection = await amqplib.connect(this.url);
    this.connection = connection;
    this.channel = await connection.createChannel();
    await this.channel.assertExchange(NOTIFICATIONS_EXCHANGE, 'topic', { durable: true });
    this.reconnectAttempts = 0;
    this.reconnecting = false;
    this.logger.info('EmailPublisher connected to RabbitMQ');

    connection.on('error', (err: Error) => {
      this.logger.error('EmailPublisher connection error', { error: err.message });
      void this.scheduleReconnect();
    });
    connection.on('close', () => {
      if (this.closed) return;
      this.logger.warn('EmailPublisher connection closed');
      void this.scheduleReconnect();
    });
  }

  publishEmail(payload: NotificationEmailPayload, routingKey: string): void {
    if (!this.channel) {
      this.logger.warn('EmailPublisher not connected — dropping email', {
        type: payload.type,
        routingKey,
      });
      return;
    }
    this.channel.publish(
      NOTIFICATIONS_EXCHANGE,
      routingKey,
      Buffer.from(JSON.stringify(payload)),
      { persistent: true, contentType: 'application/json' },
    );
    this.logger.info('Email event published', { type: payload.type, routingKey });
  }

  isConnected(): boolean {
    return this.connection !== null && this.channel !== null;
  }

  async close(): Promise<void> {
    this.closed = true;
    try {
      await this.channel?.close();
    } catch {
      /* ignore */
    }
    try {
      await this.connection?.close();
    } catch {
      /* ignore */
    }
    this.channel = null;
    this.connection = null;
  }

  private async scheduleReconnect(): Promise<void> {
    if (this.reconnecting || this.closed) return;
    this.reconnecting = true;
    this.channel = null;
    this.connection = null;

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.logger.error(
        'EmailPublisher max reconnect attempts reached — giving up; password-reset emails disabled until restart',
      );
      return;
    }

    const delay = Math.min(1000 * 2 ** this.reconnectAttempts, 30_000);
    this.reconnectAttempts++;
    this.logger.info('EmailPublisher reconnecting', {
      attempt: this.reconnectAttempts,
      delayMs: delay,
    });
    await new Promise<void>((resolve) => setTimeout(resolve, delay));

    try {
      await this.connect();
    } catch (err: unknown) {
      this.logger.error('EmailPublisher reconnect attempt failed', { error: String(err) });
      this.reconnecting = false;
      void this.scheduleReconnect();
    }
  }
}

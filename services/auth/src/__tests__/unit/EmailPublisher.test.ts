import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EmailPublisher } from '@/services/EmailPublisher';

vi.mock('@itinera/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@itinera/shared')>();
  return {
    ...actual,
    createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  };
});

const { mockChannel, mockConnection } = vi.hoisted(() => {
  const mockChannel = {
    assertExchange: vi.fn().mockResolvedValue(undefined),
    publish: vi.fn(),
    close: vi.fn(),
  };
  const mockConnection = {
    createChannel: vi.fn().mockResolvedValue(mockChannel),
    on: vi.fn(),
    close: vi.fn(),
  };
  return { mockChannel, mockConnection };
});

vi.mock('amqplib', () => ({
  default: { connect: vi.fn().mockResolvedValue(mockConnection) },
}));

describe('EmailPublisher', () => {
  let publisher: EmailPublisher;

  beforeEach(() => {
    vi.clearAllMocks();
    mockConnection.createChannel.mockResolvedValue(mockChannel);
    publisher = new EmailPublisher('amqp://user:pass@localhost:5672');
  });

  it('isConnected is false before connect', () => {
    expect(publisher.isConnected()).toBe(false);
  });

  it('connect asserts the notifications topic exchange (durable)', async () => {
    await publisher.connect();
    expect(mockChannel.assertExchange).toHaveBeenCalledWith('notifications', 'topic', {
      durable: true,
    });
    expect(publisher.isConnected()).toBe(true);
  });

  it('publishEmail publishes a persistent JSON message with the given routing key', async () => {
    await publisher.connect();
    publisher.publishEmail(
      { type: 'password-reset', to: 'alice@example.com', data: { resetUrl: 'https://x/y' } },
      'notification.email.password-reset',
    );

    expect(mockChannel.publish).toHaveBeenCalledTimes(1);
    const [exchange, routingKey, buffer, opts] = mockChannel.publish.mock.calls[0];
    expect(exchange).toBe('notifications');
    expect(routingKey).toBe('notification.email.password-reset');
    expect(JSON.parse((buffer as Buffer).toString())).toEqual({
      type: 'password-reset',
      to: 'alice@example.com',
      data: { resetUrl: 'https://x/y' },
    });
    expect(opts).toMatchObject({ persistent: true, contentType: 'application/json' });
  });

  it('publishEmail is a no-op (no throw) when not connected', () => {
    expect(() =>
      publisher.publishEmail(
        { type: 'password-changed', to: 'a@b.com', data: {} },
        'notification.email.password-changed',
      ),
    ).not.toThrow();
    expect(mockChannel.publish).not.toHaveBeenCalled();
  });

  it('close tears down channel and connection', async () => {
    await publisher.connect();
    await publisher.close();
    expect(mockChannel.close).toHaveBeenCalled();
    expect(mockConnection.close).toHaveBeenCalled();
    expect(publisher.isConnected()).toBe(false);
  });
});

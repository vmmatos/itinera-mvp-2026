import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EmailConsumer } from '@/services/EmailConsumer'
import type { EmailTransport } from '@/services/EmailService'
import type { Config } from '@/config'

vi.mock('@itinera/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@itinera/shared')>()
  return {
    ...actual,
    createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  }
})

const { mockChannel, mockConnection } = vi.hoisted(() => {
  const mockChannel = {
    prefetch: vi.fn(),
    consume: vi.fn(),
    ack: vi.fn(),
    nack: vi.fn(),
    close: vi.fn(),
  }
  const mockConnection = {
    createChannel: vi.fn().mockResolvedValue(mockChannel),
    on: vi.fn(),
    close: vi.fn(),
  }
  return { mockChannel, mockConnection }
})

vi.mock('amqplib', () => ({
  default: { connect: vi.fn().mockResolvedValue(mockConnection) },
}))

const mockTransport: EmailTransport = { send: vi.fn().mockResolvedValue(undefined) }

const mockConfig = {
  NOTIFICATION_FROM_EMAIL: 'noreply@itinera.dev',
  NOTIFICATION_FROM_NAME: 'Itinera',
} as unknown as Config

const welcomeMsg = {
  content: Buffer.from(
    JSON.stringify({ type: 'welcome', to: 'user@example.com', data: { firstName: 'Alice' } }),
  ),
}

const itineraryMsg = {
  content: Buffer.from(
    JSON.stringify({
      type: 'itinerary-ready',
      to: 'user@example.com',
      data: { firstName: 'Alice', tripName: 'Paris Trip', tripId: 'trip-123' },
    }),
  ),
}

const reminderMsg = {
  content: Buffer.from(
    JSON.stringify({
      type: 'booking-reminder',
      to: 'user@example.com',
      data: { firstName: 'Alice', tripName: 'Paris Trip', daysUntilTrip: 3 },
    }),
  ),
}

describe('EmailConsumer', () => {
  let consumer: EmailConsumer

  beforeEach(() => {
    vi.clearAllMocks()
    mockConnection.createChannel.mockResolvedValue(mockChannel)
    ;(mockTransport.send as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)
    consumer = new EmailConsumer('amqp://user:pass@localhost:5672', mockTransport, mockConfig)
  })

  it('isConnected returns false before connect', () => {
    expect(consumer.isConnected()).toBe(false)
  })

  it('connect sets up connection, channel, and prefetch', async () => {
    await consumer.connect()
    expect(consumer.isConnected()).toBe(true)
    expect(mockChannel.prefetch).toHaveBeenCalledWith(1)
  })

  it('acks on valid welcome payload', async () => {
    await consumer.connect()
    mockChannel.consume.mockImplementation((_q: string, cb: (m: unknown) => void) => cb(welcomeMsg))
    await consumer.consume('notification.email')
    await vi.waitFor(() => expect(mockChannel.ack).toHaveBeenCalledWith(welcomeMsg))
    expect(mockTransport.send).toHaveBeenCalledOnce()
    expect(mockChannel.nack).not.toHaveBeenCalled()
  })

  it('acks on valid itinerary-ready payload', async () => {
    await consumer.connect()
    mockChannel.consume.mockImplementation((_q: string, cb: (m: unknown) => void) =>
      cb(itineraryMsg),
    )
    await consumer.consume('notification.email')
    await vi.waitFor(() => expect(mockChannel.ack).toHaveBeenCalledWith(itineraryMsg))
    expect(mockTransport.send).toHaveBeenCalledOnce()
  })

  it('acks on valid booking-reminder payload', async () => {
    await consumer.connect()
    mockChannel.consume.mockImplementation((_q: string, cb: (m: unknown) => void) =>
      cb(reminderMsg),
    )
    await consumer.consume('notification.email')
    await vi.waitFor(() => expect(mockChannel.ack).toHaveBeenCalledWith(reminderMsg))
    expect(mockTransport.send).toHaveBeenCalledOnce()
  })

  it('nacks on invalid JSON', async () => {
    await consumer.connect()
    const badMsg = { content: Buffer.from('not-valid-json') }
    mockChannel.consume.mockImplementation((_q: string, cb: (m: unknown) => void) => cb(badMsg))
    await consumer.consume('notification.email')
    await vi.waitFor(() => expect(mockChannel.nack).toHaveBeenCalledWith(badMsg, false, false))
    expect(mockTransport.send).not.toHaveBeenCalled()
    expect(mockChannel.ack).not.toHaveBeenCalled()
  })

  it('nacks on schema violation (wrong type)', async () => {
    await consumer.connect()
    const badMsg = {
      content: Buffer.from(
        JSON.stringify({ type: 'unknown-type', to: 'user@example.com', data: {} }),
      ),
    }
    mockChannel.consume.mockImplementation((_q: string, cb: (m: unknown) => void) => cb(badMsg))
    await consumer.consume('notification.email')
    await vi.waitFor(() => expect(mockChannel.nack).toHaveBeenCalledWith(badMsg, false, false))
    expect(mockTransport.send).not.toHaveBeenCalled()
  })

  it('nacks when transport.send throws', async () => {
    ;(mockTransport.send as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('SendGrid error'),
    )
    await consumer.connect()
    mockChannel.consume.mockImplementation((_q: string, cb: (m: unknown) => void) => cb(welcomeMsg))
    await consumer.consume('notification.email')
    await vi.waitFor(() => expect(mockChannel.nack).toHaveBeenCalledWith(welcomeMsg, false, false))
    expect(mockChannel.ack).not.toHaveBeenCalled()
  })

  it('skips null messages — no ack or nack', async () => {
    await consumer.connect()
    mockChannel.consume.mockImplementation((_q: string, cb: (m: unknown) => void) => cb(null))
    await consumer.consume('notification.email')
    expect(mockChannel.ack).not.toHaveBeenCalled()
    expect(mockChannel.nack).not.toHaveBeenCalled()
  })

  it('close tears down channel and connection', async () => {
    await consumer.connect()
    await consumer.close()
    expect(mockChannel.close).toHaveBeenCalled()
    expect(mockConnection.close).toHaveBeenCalled()
    expect(consumer.isConnected()).toBe(false)
  })

  it('consume throws if not connected', async () => {
    await expect(consumer.consume('notification.email')).rejects.toThrow(
      'Not connected to RabbitMQ',
    )
  })
})

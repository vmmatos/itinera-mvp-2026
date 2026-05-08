import { describe, it, expect, vi, beforeEach } from 'vitest'
import { RabbitMQConsumer } from '@/services/RabbitMQConsumer'

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

describe('RabbitMQConsumer', () => {
  let consumer: RabbitMQConsumer

  beforeEach(() => {
    vi.clearAllMocks()
    mockConnection.createChannel.mockResolvedValue(mockChannel)
    consumer = new RabbitMQConsumer('amqp://user:pass@localhost:5672')
  })

  it('isConnected returns false before connect', () => {
    expect(consumer.isConnected()).toBe(false)
  })

  it('connect sets up connection and channel with prefetch', async () => {
    await consumer.connect()
    expect(consumer.isConnected()).toBe(true)
    expect(mockChannel.prefetch).toHaveBeenCalledWith(1)
  })

  it('consume calls ack on successful message processing', async () => {
    await consumer.connect()
    const handler = vi.fn()
    const event = {
      tripId: 't1',
      type: 'agent.propose',
      agent: 'alice',
      round: 1,
      timestamp: '',
      content: {},
    }
    const msg = { content: Buffer.from(JSON.stringify(event)) }

    mockChannel.consume.mockImplementation((_queue: string, cb: (msg: unknown) => void) => {
      cb(msg)
    })

    await consumer.consume('admin.realtime', handler)

    expect(handler).toHaveBeenCalledWith(event)
    expect(mockChannel.ack).toHaveBeenCalledWith(msg)
    expect(mockChannel.nack).not.toHaveBeenCalled()
  })

  it('consume calls nack on malformed message', async () => {
    await consumer.connect()
    const handler = vi.fn()
    const msg = { content: Buffer.from('not-valid-json') }

    mockChannel.consume.mockImplementation((_queue: string, cb: (msg: unknown) => void) => {
      cb(msg)
    })

    await consumer.consume('admin.realtime', handler)

    expect(handler).not.toHaveBeenCalled()
    expect(mockChannel.nack).toHaveBeenCalledWith(msg, false, false)
    expect(mockChannel.ack).not.toHaveBeenCalled()
  })

  it('consume skips null messages', async () => {
    await consumer.connect()
    const handler = vi.fn()

    mockChannel.consume.mockImplementation((_queue: string, cb: (msg: unknown) => void) => {
      cb(null)
    })

    await consumer.consume('admin.realtime', handler)

    expect(handler).not.toHaveBeenCalled()
    expect(mockChannel.ack).not.toHaveBeenCalled()
  })

  it('close tears down channel and connection', async () => {
    await consumer.connect()
    await consumer.close()
    expect(mockChannel.close).toHaveBeenCalled()
    expect(mockConnection.close).toHaveBeenCalled()
    expect(consumer.isConnected()).toBe(false)
  })

  it('consume throws if not connected', async () => {
    await expect(consumer.consume('admin.realtime', vi.fn())).rejects.toThrow(
      'Not connected to RabbitMQ',
    )
  })
})

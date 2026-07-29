import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@itinera/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@itinera/shared')>()
  return {
    ...actual,
    createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  }
})

vi.mock('jsonwebtoken', () => ({
  default: { sign: vi.fn().mockReturnValue('mock-service-token') },
}))

vi.mock('@/config', () => ({
  config: {
    JWT_SECRET: 'test-secret',
    JWT_ISSUER: 'itinera',
    NOTIFICATION_URL: 'http://notification:3007',
  },
}))

import { NotificationClient } from '@/services/NotificationClient'

let fetchMock: ReturnType<typeof vi.fn>

describe('NotificationClient', () => {
  let client: NotificationClient

  beforeEach(() => {
    vi.clearAllMocks()
    client = new NotificationClient()
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('posts the base64-encoded PDF to notification with a signed service token', async () => {
    fetchMock.mockResolvedValue({ ok: true, text: () => Promise.resolve('') })

    const pdfBuffer = Buffer.from('%PDF-1.4 fake')
    await client.sendItineraryPdf('traveller@example.com', 'Paris Trip', 'Alice', 'itinerary-1.pdf', pdfBuffer)

    expect(fetchMock).toHaveBeenCalledWith(
      'http://notification:3007/api/v1/email/itinerary-pdf',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          Authorization: 'Bearer mock-service-token',
        }),
      }),
    )
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string) as Record<string, unknown>
    expect(body).toMatchObject({
      to: 'traveller@example.com',
      tripName: 'Paris Trip',
      firstName: 'Alice',
      filename: 'itinerary-1.pdf',
      pdfBase64: pdfBuffer.toString('base64'),
    })
  })

  it('throws when notification responds with a non-ok status', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 502, text: () => Promise.resolve('bad gateway') })

    await expect(
      client.sendItineraryPdf('traveller@example.com', 'Paris Trip', 'Alice', 'itinerary-1.pdf', Buffer.from('x')),
    ).rejects.toThrow('notification service returned 502');
  })

  it('propagates network-level fetch rejections', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'))

    await expect(
      client.sendItineraryPdf('traveller@example.com', 'Paris Trip', 'Alice', 'itinerary-1.pdf', Buffer.from('x')),
    ).rejects.toThrow('ECONNREFUSED');
  })
})

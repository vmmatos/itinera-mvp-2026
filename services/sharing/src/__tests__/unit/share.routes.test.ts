import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

vi.mock('@itinera/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@itinera/shared')>()
  return {
    ...actual,
    createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
    authMiddleware: (
      _req: express.Request,
      _res: express.Response,
      next: express.NextFunction,
    ) => {
      ;(_req as express.Request & { user: { sub: string; role: string } }).user = {
        sub: 'user-123',
        role: 'user',
      }
      next()
    },
  }
})

vi.mock('@/config', () => ({
  config: {
    SHARE_LINK_TTL_SECONDS: 604800,
    SHARING_BASE_URL: 'http://localhost:3008',
    PORT: 3008,
  },
  getRedisUrl: () => 'redis://localhost:6379',
}))

const mockGenerate = vi.fn()
const mockResolve = vi.fn()
const mockGeneratePdf = vi.fn()
const mockIsConnected = vi.fn().mockReturnValue(true)
const mockSendItineraryPdf = vi.fn()

vi.mock('@/services/ShareLinkGenerator', () => ({
  ShareLinkGenerator: vi.fn().mockImplementation(() => ({
    generate: mockGenerate,
    resolve: mockResolve,
  })),
}))

vi.mock('@/services/PDFGeneratorService', () => ({
  PDFGeneratorService: vi.fn().mockImplementation(() => ({
    generate: mockGeneratePdf,
  })),
}))

vi.mock('@/services/RedisService', () => ({
  RedisService: vi.fn().mockImplementation(() => ({
    isConnected: mockIsConnected,
    connect: vi.fn(),
    close: vi.fn(),
  })),
}))

vi.mock('@/services/NotificationClient', () => ({
  NotificationClient: vi.fn().mockImplementation(() => ({
    sendItineraryPdf: mockSendItineraryPdf,
  })),
}))

import { createHealthRouter } from '@/routes/health'
import { createPublicShareRouter } from '@/routes/share.public'
import { createProtectedShareRouter } from '@/routes/share.protected'
import { createExportRouter } from '@/routes/export'
import { ShareLinkGenerator } from '@/services/ShareLinkGenerator'
import { PDFGeneratorService } from '@/services/PDFGeneratorService'
import { RedisService } from '@/services/RedisService'
import { NotificationClient } from '@/services/NotificationClient'
import { authMiddleware, NotFoundError } from '@itinera/shared'

const validItinerary = {
  tripName: 'Paris Trip',
  tripId: '123e4567-e89b-12d3-a456-426614174000',
  days: [{ day: 1, activities: [{ name: 'Eiffel Tower' }] }],
}

const validTripId = '550e8400-e29b-41d4-a716-446655440000'

function buildApp(): express.Express {
  const redis = new RedisService()
  const generator = new ShareLinkGenerator(redis)
  const pdfGenerator = new PDFGeneratorService()
  const notificationClient = new NotificationClient()

  const app = express()
  app.use(express.json())
  app.use(createHealthRouter(redis))
  app.use('/api/v1/share', createPublicShareRouter(generator))
  app.use('/api/v1/share', authMiddleware, createProtectedShareRouter(generator))
  app.use('/api/v1/export', authMiddleware, createExportRouter(pdfGenerator, notificationClient))

  // error handler
  app.use(
    (
      err: Error & { statusCode?: number; code?: string },
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      const status = err.statusCode ?? 500
      res.status(status).json({
        success: false,
        error: { code: err.code ?? 'INTERNAL_ERROR', message: err.message },
      })
    },
  )

  return app
}

describe('Health routes', () => {
  it('GET /health returns 200 with ok status', async () => {
    const app = buildApp()
    const res = await request(app).get('/health')
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('ok')
    expect(res.body.service).toBe('sharing')
  })

  it('GET /ready returns 200 when Redis connected', async () => {
    mockIsConnected.mockReturnValue(true)
    const app = buildApp()
    const res = await request(app).get('/ready')
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('ready')
    expect(res.body.checks.redis).toBe(true)
  })

  it('GET /ready returns 503 when Redis not connected', async () => {
    mockIsConnected.mockReturnValue(false)
    const app = buildApp()
    const res = await request(app).get('/ready')
    expect(res.status).toBe(503)
    expect(res.body.status).toBe('not_ready')
    expect(res.body.checks.redis).toBe(false)
  })
})

describe('POST /api/v1/share/generate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsConnected.mockReturnValue(true)
  })

  it('returns 201 with shareId, shareUrl, expiresAt on valid body', async () => {
    mockGenerate.mockResolvedValue({
      shareId: 'abc-123',
      shareUrl: 'http://localhost:3008/api/v1/share/abc-123',
      expiresAt: '2026-05-26T10:00:00.000Z',
    })

    const app = buildApp()
    const res = await request(app)
      .post('/api/v1/share/generate')
      .send({ tripId: validTripId, itinerary: validItinerary })

    expect(res.status).toBe(201)
    expect(res.body.success).toBe(true)
    expect(res.body.data.shareId).toBe('abc-123')
    expect(res.body.data.shareUrl).toContain('abc-123')
  })

  it('returns 400 when tripId is missing', async () => {
    const app = buildApp()
    const res = await request(app)
      .post('/api/v1/share/generate')
      .send({ itinerary: validItinerary })

    expect(res.status).toBe(400)
    expect(res.body.success).toBe(false)
  })

  it('returns 400 when tripId is not a UUID', async () => {
    const app = buildApp()
    const res = await request(app)
      .post('/api/v1/share/generate')
      .send({ tripId: 'not-a-uuid', itinerary: validItinerary })

    expect(res.status).toBe(400)
  })

  it('returns 400 when itinerary.tripName is missing', async () => {
    const app = buildApp()
    const { tripName: _, ...noName } = validItinerary
    const res = await request(app)
      .post('/api/v1/share/generate')
      .send({ tripId: validTripId, itinerary: noName })

    expect(res.status).toBe(400)
  })

  it('returns 400 when itinerary.days is missing', async () => {
    const app = buildApp()
    const { days: _, ...noDays } = validItinerary
    const res = await request(app)
      .post('/api/v1/share/generate')
      .send({ tripId: validTripId, itinerary: noDays })

    expect(res.status).toBe(400)
  })

  it('returns 500 when generator.generate throws', async () => {
    mockGenerate.mockRejectedValue(new Error('Redis down'))
    const app = buildApp()
    const res = await request(app)
      .post('/api/v1/share/generate')
      .send({ tripId: validTripId, itinerary: validItinerary })

    expect(res.status).toBe(500)
  })
})

describe('GET /api/v1/share/:id', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsConnected.mockReturnValue(true)
  })

  it('returns 200 with share data when found', async () => {
    const shareData = {
      shareId: validTripId,
      tripId: validTripId,
      itinerary: validItinerary,
      createdAt: '2026-05-19T10:00:00.000Z',
      expiresAt: '2026-05-26T10:00:00.000Z',
    }
    mockResolve.mockResolvedValue(shareData)

    const app = buildApp()
    const res = await request(app).get(`/api/v1/share/${validTripId}`)

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.shareId).toBe(validTripId)
  })

  it('returns 404 when generator.resolve throws NotFoundError', async () => {
    mockResolve.mockRejectedValue(new NotFoundError('Share link not-found-id'))

    const app = buildApp()
    const res = await request(app).get('/api/v1/share/not-found-id')

    expect(res.status).toBe(404)
    expect(res.body.success).toBe(false)
  })

  it('returns 500 when generator.resolve throws non-operational error', async () => {
    mockResolve.mockRejectedValue(new Error('Unexpected error'))

    const app = buildApp()
    const res = await request(app).get(`/api/v1/share/${validTripId}`)

    expect(res.status).toBe(500)
  })
})

describe('POST /api/v1/export/pdf', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsConnected.mockReturnValue(true)
  })

  it('returns 200 with Content-Type application/pdf', async () => {
    mockGeneratePdf.mockResolvedValue(Buffer.from([37, 80, 68, 70]))

    const app = buildApp()
    const res = await request(app)
      .post('/api/v1/export/pdf')
      .send({ tripId: validTripId, itinerary: validItinerary })

    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toContain('application/pdf')
  })

  it('returns Content-Disposition with tripId filename', async () => {
    mockGeneratePdf.mockResolvedValue(Buffer.from([37, 80, 68, 70]))

    const app = buildApp()
    const res = await request(app)
      .post('/api/v1/export/pdf')
      .send({ tripId: validTripId, itinerary: validItinerary })

    expect(res.headers['content-disposition']).toContain(validTripId)
  })

  it('returns 400 when tripId is missing', async () => {
    const app = buildApp()
    const res = await request(app)
      .post('/api/v1/export/pdf')
      .send({ itinerary: validItinerary })

    expect(res.status).toBe(400)
  })

  it('returns 400 when itinerary is malformed', async () => {
    const app = buildApp()
    const res = await request(app)
      .post('/api/v1/export/pdf')
      .send({ tripId: validTripId, itinerary: { invalid: true } })

    expect(res.status).toBe(400)
  })

  it('accepts meals with location and rating', async () => {
    mockGeneratePdf.mockResolvedValue(Buffer.from([37, 80, 68, 70]))

    const app = buildApp()
    const res = await request(app)
      .post('/api/v1/export/pdf')
      .send({
        tripId: validTripId,
        itinerary: {
          ...validItinerary,
          days: [
            {
              day: 1,
              activities: [{ name: 'Eiffel Tower' }],
              meals: [{ type: 'Lunch', name: 'Ramiro', location: 'Intendente', rating: 4.6 }],
            },
          ],
        },
      })

    expect(res.status).toBe(200)
  })

  it('rejects a meal rating outside 0-5', async () => {
    const app = buildApp()
    const res = await request(app)
      .post('/api/v1/export/pdf')
      .send({
        tripId: validTripId,
        itinerary: {
          ...validItinerary,
          days: [
            {
              day: 1,
              activities: [{ name: 'Eiffel Tower' }],
              meals: [{ type: 'Lunch', name: 'Ramiro', rating: 9 }],
            },
          ],
        },
      })

    expect(res.status).toBe(400)
  })

  it('returns 500 when pdfGenerator.generate throws', async () => {
    mockGeneratePdf.mockRejectedValue(new Error('Chromium crashed'))

    const app = buildApp()
    const res = await request(app)
      .post('/api/v1/export/pdf')
      .send({ tripId: validTripId, itinerary: validItinerary })

    expect(res.status).toBe(500)
  })
})

describe('POST /api/v1/export/email', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsConnected.mockReturnValue(true)
  })

  it('returns 200 and forwards the generated PDF + traveller name to NotificationClient', async () => {
    mockGeneratePdf.mockResolvedValue(Buffer.from([37, 80, 68, 70]))
    mockSendItineraryPdf.mockResolvedValue(undefined)

    const app = buildApp()
    const res = await request(app)
      .post('/api/v1/export/email')
      .send({ tripId: validTripId, itinerary: validItinerary, to: 'traveller@example.com' })

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.sent).toBe(true)

    expect(mockSendItineraryPdf).toHaveBeenCalledOnce()
    const [to, tripName, firstName, filename, pdfBuffer] = mockSendItineraryPdf.mock.calls[0] as [
      string, string, string, string, Buffer,
    ]
    expect(to).toBe('traveller@example.com')
    expect(tripName).toBe('Paris Trip')
    expect(firstName).toBe('there') // validItinerary has no travellers
    expect(filename).toBe(`itinerary-${validTripId}.pdf`)
    expect(pdfBuffer).toEqual(Buffer.from([37, 80, 68, 70]))
  })

  it('uses the first traveller\'s name as the greeting when present', async () => {
    mockGeneratePdf.mockResolvedValue(Buffer.from([37, 80, 68, 70]))
    mockSendItineraryPdf.mockResolvedValue(undefined)

    const app = buildApp()
    await request(app)
      .post('/api/v1/export/email')
      .send({
        tripId: validTripId,
        itinerary: { ...validItinerary, travellers: [{ name: 'Alice' }, { name: 'Bob' }] },
        to: 'traveller@example.com',
      })

    const firstName = mockSendItineraryPdf.mock.calls[0][2] as string
    expect(firstName).toBe('Alice')
  })

  it('returns 400 when "to" is not a valid email', async () => {
    const app = buildApp()
    const res = await request(app)
      .post('/api/v1/export/email')
      .send({ tripId: validTripId, itinerary: validItinerary, to: 'not-an-email' })

    expect(res.status).toBe(400)
    expect(mockSendItineraryPdf).not.toHaveBeenCalled()
  })

  it('returns 400 when tripId is missing', async () => {
    const app = buildApp()
    const res = await request(app)
      .post('/api/v1/export/email')
      .send({ itinerary: validItinerary, to: 'traveller@example.com' })

    expect(res.status).toBe(400)
  })

  it('returns 500 when pdfGenerator.generate throws', async () => {
    mockGeneratePdf.mockRejectedValue(new Error('Chromium crashed'))

    const app = buildApp()
    const res = await request(app)
      .post('/api/v1/export/email')
      .send({ tripId: validTripId, itinerary: validItinerary, to: 'traveller@example.com' })

    expect(res.status).toBe(500)
    expect(mockSendItineraryPdf).not.toHaveBeenCalled()
  })

  it('returns 500 when NotificationClient.sendItineraryPdf rejects', async () => {
    mockGeneratePdf.mockResolvedValue(Buffer.from([37, 80, 68, 70]))
    mockSendItineraryPdf.mockRejectedValue(new Error('notification service returned 500'))

    const app = buildApp()
    const res = await request(app)
      .post('/api/v1/export/email')
      .send({ tripId: validTripId, itinerary: validItinerary, to: 'traveller@example.com' })

    expect(res.status).toBe(500)
  })
})

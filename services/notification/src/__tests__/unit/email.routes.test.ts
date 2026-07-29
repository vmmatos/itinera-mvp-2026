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
        sub: 'sharing',
        role: 'service',
      }
      next()
    },
  }
})

const mockSend = vi.fn()

import { createEmailRouter } from '@/routes/email'
import { authMiddleware } from '@itinera/shared'
import type { EmailTransport } from '@/services/EmailService'
import type { Config } from '@/config'

const config = {
  NOTIFICATION_FROM_EMAIL: 'noreply@itinera.dev',
  NOTIFICATION_FROM_NAME: 'Itinera',
} as unknown as Config

const transport: EmailTransport = { send: mockSend }

function buildApp(): express.Express {
  const app = express()
  app.use(express.json({ limit: '10mb' }))
  app.use('/api/v1/email', authMiddleware, createEmailRouter(transport, config))

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

const validBody = {
  to: 'traveller@example.com',
  tripName: 'Barcelona + Dublin',
  firstName: 'Alice',
  filename: 'itinerary-123.pdf',
  pdfBase64: Buffer.from('%PDF-1.4 fake').toString('base64'),
}

describe('POST /api/v1/email/itinerary-pdf', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSend.mockResolvedValue(undefined)
  })

  it('returns 200 and calls transport.send with the decoded PDF attached', async () => {
    const app = buildApp()
    const res = await request(app).post('/api/v1/email/itinerary-pdf').send(validBody)

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.sent).toBe(true)

    expect(mockSend).toHaveBeenCalledOnce()
    const [to, from, rendered, attachments] = mockSend.mock.calls[0] as [
      string,
      { email: string; name: string },
      { subject: string },
      Array<{ filename: string; content: Buffer; contentType: string }>,
    ]
    expect(to).toBe('traveller@example.com')
    expect(from).toEqual({ email: 'noreply@itinera.dev', name: 'Itinera' })
    expect(rendered.subject).toContain('Barcelona + Dublin')
    expect(attachments).toHaveLength(1)
    expect(attachments[0]?.filename).toBe('itinerary-123.pdf')
    expect(attachments[0]?.contentType).toBe('application/pdf')
    expect(attachments[0]?.content.toString()).toBe('%PDF-1.4 fake')
  })

  it('defaults the greeting name to "there" when firstName is omitted', async () => {
    const app = buildApp()
    const { firstName: _omit, ...body } = validBody
    await request(app).post('/api/v1/email/itinerary-pdf').send(body)

    const rendered = mockSend.mock.calls[0][2] as { html: string }
    expect(rendered.html).toContain('Hi there')
  })

  it('returns 400 when "to" is not a valid email', async () => {
    const app = buildApp()
    const res = await request(app)
      .post('/api/v1/email/itinerary-pdf')
      .send({ ...validBody, to: 'not-an-email' })

    expect(res.status).toBe(400)
    expect(res.body.success).toBe(false)
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('returns 400 when pdfBase64 is missing', async () => {
    const app = buildApp()
    const { pdfBase64: _omit, ...body } = validBody
    const res = await request(app).post('/api/v1/email/itinerary-pdf').send(body)

    expect(res.status).toBe(400)
  })

  it('returns 500 when transport.send rejects', async () => {
    mockSend.mockRejectedValue(new Error('SMTP connection refused'))
    const app = buildApp()
    const res = await request(app).post('/api/v1/email/itinerary-pdf').send(validBody)

    expect(res.status).toBe(500)
    expect(res.body.success).toBe(false)
  })
})

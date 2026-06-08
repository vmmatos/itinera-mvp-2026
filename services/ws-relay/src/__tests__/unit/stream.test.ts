import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Request, Response } from 'express'
import type { AuthenticatedRequest, JwtPayload } from '@itinera/shared'
import { createStreamRouter } from '@/routes/stream'
import { SSEManager } from '@/services/SSEManager'

// Mutable mock user — tests override `.role` per scenario
const mockUser = vi.hoisted(() => ({
  value: { sub: 'user-1', role: 'admin' as JwtPayload['role'], iss: 'itinera', exp: 9999999999 },
}))

vi.mock('@itinera/shared', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  authMiddleware: (req: Request, _res: Response, next: () => void) => {
    ;(req as AuthenticatedRequest).user = { ...mockUser.value }
    next()
  },
}))

vi.mock('@/services/SSEManager')

function makeReq(query: Record<string, string>): Request {
  return {
    method: 'GET',
    url: '/stream?' + new URLSearchParams(query).toString(),
    path: '/stream',
    query,
    on: vi.fn(),
  } as unknown as Request
}

function makeRes(): Response {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    setHeader: vi.fn(),
    flushHeaders: vi.fn(),
    write: vi.fn(),
    end: vi.fn(),
  } as unknown as Response
}

describe('GET /stream', () => {
  let sseManager: SSEManager
  let router: ReturnType<typeof createStreamRouter>

  beforeEach(() => {
    sseManager = new SSEManager()
    vi.mocked(sseManager.addClient).mockImplementation(() => undefined)
    mockUser.value.role = 'admin'
    router = createStreamRouter(sseManager)
  })

  it('returns 403 when role=admin param but JWT role is user', () => {
    mockUser.value.role = 'user'
    const req = makeReq({ tripId: 'trip-1', role: 'admin' })
    const res = makeRes()

    router(req, res, vi.fn())

    expect(res.status).toHaveBeenCalledWith(403)
    expect(res.json).toHaveBeenCalledWith({ error: 'Forbidden' })
    expect(sseManager.addClient).not.toHaveBeenCalled()
  })

  it('opens SSE stream when role=admin param and JWT role is admin', () => {
    mockUser.value.role = 'admin'
    const req = makeReq({ tripId: 'trip-1', role: 'admin' })
    const res = makeRes()

    router(req, res, vi.fn())

    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/event-stream')
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-cache')
    expect(sseManager.addClient).toHaveBeenCalledWith(
      expect.any(String),
      res,
      'trip-1',
    )
  })

  it('opens SSE stream when no role param regardless of JWT role', () => {
    mockUser.value.role = 'user'
    const req = makeReq({ tripId: 'trip-1' })
    const res = makeRes()

    router(req, res, vi.fn())

    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/event-stream')
    expect(sseManager.addClient).toHaveBeenCalled()
  })

  it('passes undefined tripId to addClient when tripId param is absent', () => {
    const req = makeReq({})
    const res = makeRes()

    router(req, res, vi.fn())

    expect(sseManager.addClient).toHaveBeenCalledWith(
      expect.any(String),
      res,
      undefined,
    )
  })
})

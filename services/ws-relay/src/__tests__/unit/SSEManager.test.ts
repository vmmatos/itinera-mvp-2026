import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Response } from 'express'
import { SSEManager } from '@/services/SSEManager'

vi.mock('@itinera/shared', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}))

function mockResponse(): Response {
  return { write: vi.fn(), end: vi.fn() } as unknown as Response
}

describe('SSEManager', () => {
  let manager: SSEManager

  beforeEach(() => {
    manager = new SSEManager()
  })

  it('addClient stores client and sends retry directive', () => {
    const res = mockResponse()
    manager.addClient('c1', res)
    expect(manager.clientCount()).toBe(1)
    expect(res.write).toHaveBeenCalledWith('retry: 3000\n\n')
  })

  it('removeClient decrements count', () => {
    manager.addClient('c1', mockResponse())
    manager.removeClient('c1')
    expect(manager.clientCount()).toBe(0)
  })

  it('broadcast sends to all clients', () => {
    const res1 = mockResponse()
    const res2 = mockResponse()
    manager.addClient('c1', res1)
    manager.addClient('c2', res2)
    manager.broadcast({ foo: 'bar' }, 'agent')
    expect(res1.write).toHaveBeenCalledWith(expect.stringContaining('"foo":"bar"'))
    expect(res2.write).toHaveBeenCalledWith(expect.stringContaining('"foo":"bar"'))
  })

  it('broadcastToTrip sends to matching and unfiltered clients only', () => {
    const resAll = mockResponse()
    const resMatch = mockResponse()
    const resOther = mockResponse()
    manager.addClient('all', resAll)
    manager.addClient('match', resMatch, 'trip-123')
    manager.addClient('other', resOther, 'trip-456')
    manager.broadcastToTrip('trip-123', { x: 1 }, 'trip')
    expect(resAll.write).toHaveBeenCalledWith(expect.stringContaining('"x":1'))
    expect(resMatch.write).toHaveBeenCalledWith(expect.stringContaining('"x":1'))
    expect(resOther.write).not.toHaveBeenCalledWith(expect.stringContaining('"x":1'))
  })

  it('broadcast removes client on write failure', () => {
    const writeFn = vi.fn()
      .mockImplementationOnce(() => undefined) // retry directive succeeds
      .mockImplementationOnce(() => { throw new Error('broken pipe') }) // broadcast fails
    const res = { write: writeFn, end: vi.fn() } as unknown as Response
    manager.addClient('broken', res)
    expect(manager.clientCount()).toBe(1)
    manager.broadcast({ test: true })
    expect(manager.clientCount()).toBe(0)
  })

  it('closeAll ends all connections and clears map', () => {
    const res1 = mockResponse()
    const res2 = mockResponse()
    manager.addClient('c1', res1)
    manager.addClient('c2', res2)
    manager.closeAll()
    expect(res1.end).toHaveBeenCalled()
    expect(res2.end).toHaveBeenCalled()
    expect(manager.clientCount()).toBe(0)
  })

  it('broadcastToTrip skips clients with different tripId', () => {
    const res = mockResponse()
    manager.addClient('c1', res, 'trip-999')
    manager.broadcastToTrip('trip-123', { data: true })
    expect(res.write).toHaveBeenCalledTimes(1) // only retry directive on addClient
  })
})

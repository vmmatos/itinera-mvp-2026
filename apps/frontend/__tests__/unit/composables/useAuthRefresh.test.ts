import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mockFetch } from '../../setup'
import { refreshSession, __resetAuthRefreshForTests } from '~/composables/useAuthRefresh'

const user = {
  id: 'u1', email: 'a@b.com', name: 'Alice', role: 'user',
  language: 'en', theme: 'dark', hasSeenWalkthrough: false,
}

beforeEach(() => {
  mockFetch.mockReset()
  __resetAuthRefreshForTests()
})

describe('refreshSession()', () => {
  it('POSTs /api/auth/refresh with credentials and returns the token + user on 2xx', async () => {
    mockFetch.mockResolvedValue({ success: true, data: { token: 't1', user } })

    const outcome = await refreshSession()

    expect(outcome).toEqual({ ok: true, token: 't1', user })
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost/api/auth/refresh',
      expect.objectContaining({ method: 'POST', credentials: 'include' }),
    )
  })

  it('returns ok with no user when the backend omits it', async () => {
    mockFetch.mockResolvedValue({ success: true, data: { token: 't1' } })

    expect(await refreshSession()).toEqual({ ok: true, token: 't1', user: undefined })
  })

  it('classifies 401 as no-session', async () => {
    mockFetch.mockRejectedValue({ status: 401 })
    expect(await refreshSession()).toEqual({ ok: false, reason: 'no-session' })
  })

  it('classifies 403 as no-session', async () => {
    mockFetch.mockRejectedValue({ response: { status: 403 } })
    expect(await refreshSession()).toEqual({ ok: false, reason: 'no-session' })
  })

  it('classifies a bare network error as transient', async () => {
    mockFetch.mockRejectedValue(new Error('Failed to fetch'))
    expect(await refreshSession()).toEqual({ ok: false, reason: 'transient' })
  })

  it('retries a 5xx exactly once', async () => {
    vi.useFakeTimers()
    mockFetch.mockRejectedValueOnce({ status: 502 }).mockResolvedValueOnce({ success: true, data: { token: 't2' } })

    const p = refreshSession()
    await vi.advanceTimersByTimeAsync(400)
    const outcome = await p
    vi.useRealTimers()

    expect(outcome).toEqual({ ok: true, token: 't2', user: undefined })
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it('does NOT retry a 429', async () => {
    mockFetch.mockRejectedValue({ status: 429 })

    expect(await refreshSession()).toEqual({ ok: false, reason: 'transient' })
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('shares one in-flight request between concurrent callers', async () => {
    let resolve!: (v: unknown) => void
    mockFetch.mockReturnValue(new Promise((r) => { resolve = r }))

    const a = refreshSession()
    const b = refreshSession()
    expect(a).toBe(b)

    resolve({ success: true, data: { token: 't1' } })
    await a
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('starts a fresh request once the previous one settled', async () => {
    mockFetch.mockResolvedValue({ success: true, data: { token: 't1' } })

    await refreshSession()
    await refreshSession()

    expect(mockFetch).toHaveBeenCalledTimes(2)
  })
})

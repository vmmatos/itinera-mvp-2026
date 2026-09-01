import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import axios from 'axios'
import type { AxiosAdapter } from 'axios'
import { mockFetch, mockNavigateTo, authStoreMock } from '../../setup'
import { __resetAuthRefreshForTests } from '~/composables/useAuthRefresh'
import { useApi } from '~/composables/useApi'

// Drive the real axios instance created inside useApi() through a stub adapter:
// each queued handler answers the next outbound request. A non-2xx status makes
// axios reject with an AxiosError carrying `.response`, exercising the 401 path.
type Handler = (url: string | undefined) => { status: number; data?: unknown }
let handlers: Handler[] = []
const realAdapter = axios.defaults.adapter

const stubAdapter: AxiosAdapter = async (config) => {
  const handler = handlers.shift()
  if (!handler) throw new Error(`useApi.test: no queued handler for ${config.url}`)
  const { status, data } = handler(config.url)
  const response = { status, statusText: '', data: data ?? {}, headers: {}, config } as never
  if (status >= 200 && status < 300) return response
  throw Object.assign(new Error(`Request failed with status code ${status}`), {
    response: response,
    config,
    isAxiosError: true,
  })
}

beforeEach(() => {
  handlers = []
  mockFetch.mockReset()
  mockNavigateTo.mockClear()
  authStoreMock.setSession.mockClear()
  authStoreMock.clearSession.mockClear()
  authStoreMock.token = 'mock-token'
  __resetAuthRefreshForTests()
  axios.defaults.adapter = stubAdapter
})

afterAll(() => {
  axios.defaults.adapter = realAdapter
})

const user = { id: 'u1', email: 'a@b.com', name: 'Al', role: 'user', language: 'en', theme: 'dark', hasSeenWalkthrough: false }

describe('useApi 401 handling', () => {
  it('refreshes once, re-hydrates {token,user}, and replays the original request', async () => {
    handlers = [
      () => ({ status: 401 }),
      () => ({ status: 200, data: { ok: true } }),
    ]
    mockFetch.mockResolvedValue({ success: true, data: { token: 'new-token', user } })

    const res = await useApi().get('/api/v1/trips')

    expect(res.data).toEqual({ ok: true })
    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(authStoreMock.setSession).toHaveBeenCalledWith({ token: 'new-token', user })
  })

  it('clears the session and redirects to login when the refresh says no-session', async () => {
    handlers = [() => ({ status: 401 })]
    mockFetch.mockRejectedValue({ status: 401 })

    await expect(useApi().get('/api/v1/trips')).rejects.toBeDefined()

    expect(authStoreMock.clearSession).toHaveBeenCalled()
    expect(mockNavigateTo).toHaveBeenCalledWith('/auth/login', { replace: true })
  })

  it('leaves the session intact on a transient refresh failure', async () => {
    handlers = [() => ({ status: 401 })]
    mockFetch.mockRejectedValue(new Error('offline'))

    await expect(useApi().get('/api/v1/trips')).rejects.toBeDefined()

    expect(authStoreMock.clearSession).not.toHaveBeenCalled()
    expect(mockNavigateTo).not.toHaveBeenCalled()
  })

  it('does not loop when the replayed request also 401s', async () => {
    handlers = [() => ({ status: 401 }), () => ({ status: 401 })]
    mockFetch.mockResolvedValue({ success: true, data: { token: 'new-token' } })

    await expect(useApi().get('/api/v1/trips')).rejects.toBeDefined()

    expect(mockFetch).toHaveBeenCalledTimes(1)
  })
})

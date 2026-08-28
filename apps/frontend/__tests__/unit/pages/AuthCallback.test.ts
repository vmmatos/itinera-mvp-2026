import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { mockNavigateTo } from '../../setup'
import AuthCallback from '~/pages/auth/callback.vue'

const setFromOAuth = vi.fn()
const mockFetch = vi.fn()

beforeEach(() => {
  mockNavigateTo.mockClear()
  setFromOAuth.mockClear()
  mockFetch.mockReset()
  ;(globalThis as Record<string, unknown>).$fetch = mockFetch
  ;(globalThis as Record<string, unknown>).useAuthStore = vi.fn(() => ({ setFromOAuth }))
  ;(globalThis as Record<string, unknown>).useRuntimeConfig = vi.fn(() => ({ public: { apiBase: 'http://localhost' } }))
})

const mountWithQuery = (query: Record<string, string>) => {
  ;(globalThis as Record<string, unknown>).useRoute = vi.fn(() => ({ query }))
  return mount(AuthCallback, { global: { plugins: [createPinia()] } })
}

describe('auth/callback page', () => {
  it('exchanges the code and seeds the session from the returned user (no JWT decode)', async () => {
    const user = {
      id: 'u1', email: 'a@b.com', name: 'Alice', role: 'user',
      language: 'pt', theme: 'light', hasSeenWalkthrough: true,
    }
    mockFetch.mockResolvedValue({ success: true, data: { token: 'tok', user } })

    mountWithQuery({ code: 'the-code' })
    await flushPromises()

    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost/api/auth/exchange',
      { method: 'POST', body: { code: 'the-code' } },
    )
    expect(setFromOAuth).toHaveBeenCalledWith({ token: 'tok', user })
    expect(mockNavigateTo).toHaveBeenCalledWith('/', { replace: true })
  })

  it('redirects to login when the code is missing', async () => {
    mountWithQuery({})
    await flushPromises()

    expect(mockFetch).not.toHaveBeenCalled()
    expect(mockNavigateTo).toHaveBeenCalledWith('/auth/login?error=oauth_failed', { replace: true })
  })

  it('redirects to login when the exchange call fails', async () => {
    mockFetch.mockRejectedValue(new Error('bad code'))

    mountWithQuery({ code: 'stale' })
    await flushPromises()

    expect(setFromOAuth).not.toHaveBeenCalled()
    expect(mockNavigateTo).toHaveBeenCalledWith('/auth/login?error=oauth_failed', { replace: true })
  })
})

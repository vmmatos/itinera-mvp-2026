import { describe, it, expect, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mockApiPatch, mockApiPost, mockFetch, mockSetLocale, mockSetThemeMode } from '../../setup'
import { useAuthStore } from '~/stores/auth'
import { __resetAuthRefreshForTests } from '~/composables/useAuthRefresh'

const publicUser = (overrides: Record<string, unknown> = {}) => ({
  id: 'user-1', email: 'a@b.com', name: 'Alice', role: 'user',
  language: 'en', theme: 'dark', hasSeenWalkthrough: false, ...overrides,
})

describe('useAuthStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    mockApiPatch.mockClear()
    mockApiPost.mockClear()
    mockFetch.mockReset()
    mockSetLocale.mockClear()
    mockSetThemeMode.mockClear()
    __resetAuthRefreshForTests()
  })

  describe('completeWalkthrough()', () => {
    it('PATCHes the walkthrough endpoint and updates the user flag from the response', async () => {
      const store = useAuthStore()
      store.user = publicUser({ hasSeenWalkthrough: false })
      mockApiPatch.mockResolvedValue({ data: { success: true, data: publicUser({ hasSeenWalkthrough: true }) } })

      await store.completeWalkthrough()

      expect(mockApiPatch).toHaveBeenCalledWith('/api/auth/me/walkthrough', {})
      expect(store.user?.hasSeenWalkthrough).toBe(true)
    })

    it('does not throw when there is no current user', async () => {
      const store = useAuthStore()
      store.user = null
      mockApiPatch.mockResolvedValue({ data: { success: true, data: publicUser({ hasSeenWalkthrough: true }) } })

      await expect(store.completeWalkthrough()).resolves.toBeUndefined()
      expect(store.user).toBeNull()
    })
  })

  describe('tryRefresh()', () => {
    const refreshOk = (over: Record<string, unknown> = {}) =>
      ({ success: true, data: { token: 'fresh-token', ...over } })

    it('re-hydrates the user and syncs locale + theme when the backend returns one', async () => {
      const store = useAuthStore()
      mockFetch.mockResolvedValue(refreshOk({ user: publicUser({ language: 'pt', theme: 'light' }) }))

      const ok = await store.tryRefresh()

      expect(ok).toBe(true)
      expect(store.token).toBe('fresh-token')
      expect(store.user?.language).toBe('pt')
      expect(mockSetLocale).toHaveBeenCalledWith('pt')
      expect(mockSetThemeMode).toHaveBeenCalledWith('light')
    })

    it('still yields a valid session when the backend only returns a token', async () => {
      const store = useAuthStore()
      mockFetch.mockResolvedValue(refreshOk())

      const ok = await store.tryRefresh()

      expect(ok).toBe(true)
      expect(store.token).toBe('fresh-token')
    })

    it('keeps an existing session on a transient network error', async () => {
      const store = useAuthStore()
      store.setSession({ token: 'live-token', user: publicUser() })
      mockFetch.mockRejectedValue(new Error('offline')) // no status → network

      const ok = await store.tryRefresh()

      expect(ok).toBe(true)
      expect(store.token).toBe('live-token')
      expect(store.user).not.toBeNull()
    })

    it('returns false without throwing when transient and there was no session', async () => {
      const store = useAuthStore()
      mockFetch.mockRejectedValue(new Error('offline'))

      const ok = await store.tryRefresh()

      expect(ok).toBe(false)
      expect(store.token).toBeNull()
    })

    it('clears the session and returns false on a definitive 401', async () => {
      const store = useAuthStore()
      store.setSession({ token: 'live-token', user: publicUser() })
      mockFetch.mockRejectedValue({ status: 401 })

      const ok = await store.tryRefresh()

      expect(ok).toBe(false)
      expect(store.token).toBeNull()
      expect(store.user).toBeNull()
    })

    it('retries once on a 5xx then succeeds', async () => {
      const store = useAuthStore()
      mockFetch
        .mockRejectedValueOnce({ status: 503 })
        .mockResolvedValueOnce(refreshOk())

      const ok = await store.tryRefresh()

      expect(ok).toBe(true)
      expect(store.token).toBe('fresh-token')
      expect(mockFetch).toHaveBeenCalledTimes(2)
    })

    it('dedupes concurrent callers onto a single refresh request', async () => {
      const store = useAuthStore()
      mockFetch.mockResolvedValue(refreshOk())

      const [a, b] = await Promise.all([store.tryRefresh(), store.tryRefresh()])

      expect(a).toBe(true)
      expect(b).toBe(true)
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })
  })

  describe('clearSession()', () => {
    it('also clears a stale error banner', () => {
      const store = useAuthStore()
      store.error = 'Invalid credentials. Please try again.'

      store.clearSession()

      expect(store.error).toBeNull()
    })
  })

  describe('updateTheme()', () => {
    it('PATCHes /api/auth/me with the theme and updates the user record', async () => {
      const store = useAuthStore()
      store.user = publicUser({ theme: 'dark' })
      mockApiPatch.mockResolvedValue({ data: { success: true, data: publicUser({ theme: 'light' }) } })

      await store.updateTheme('light')

      expect(mockApiPatch).toHaveBeenCalledWith('/api/auth/me', { theme: 'light' })
      expect(store.user?.theme).toBe('light')
    })
  })

  describe('requestPasswordReset()', () => {
    it('POSTs the email to the forgot-password endpoint', async () => {
      const store = useAuthStore()
      mockApiPost.mockResolvedValue({ data: { success: true, data: { message: 'ok' } } })

      await store.requestPasswordReset('a@b.com')

      expect(mockApiPost).toHaveBeenCalledWith('/api/auth/forgot-password', { email: 'a@b.com' })
      expect(store.error).toBeNull()
    })

    it('surfaces the backend message and rethrows on failure', async () => {
      const store = useAuthStore()
      mockApiPost.mockRejectedValue({ response: { data: { error: { message: 'rate limited' } } } })

      await expect(store.requestPasswordReset('a@b.com')).rejects.toBeDefined()
      expect(store.error).toBe('rate limited')
      expect(store.loading).toBe(false)
    })
  })

  describe('resetPassword()', () => {
    it('POSTs the token + new password to the reset-password endpoint', async () => {
      const store = useAuthStore()
      mockApiPost.mockResolvedValue({ data: { success: true, data: { message: 'ok' } } })

      await store.resetPassword('raw-token', 'brand-new-pass')

      expect(mockApiPost).toHaveBeenCalledWith('/api/auth/reset-password', {
        token: 'raw-token',
        password: 'brand-new-pass',
      })
    })

    it('surfaces an invalid-link error and rethrows on failure', async () => {
      const store = useAuthStore()
      mockApiPost.mockRejectedValue({ response: { data: { error: { message: 'invalid or expired' } } } })

      await expect(store.resetPassword('bad', 'brand-new-pass')).rejects.toBeDefined()
      expect(store.error).toBe('invalid or expired')
    })
  })

  describe('setFromOAuth()', () => {
    it('sets token + user (incl. theme) and syncs settings', () => {
      const store = useAuthStore()

      store.setFromOAuth({ token: 't', user: publicUser({ language: 'pt', theme: 'light' }) })

      expect(store.token).toBe('t')
      expect(store.user?.theme).toBe('light')
      expect(mockSetLocale).toHaveBeenCalledWith('pt')
      expect(mockSetThemeMode).toHaveBeenCalledWith('light')
    })
  })
})

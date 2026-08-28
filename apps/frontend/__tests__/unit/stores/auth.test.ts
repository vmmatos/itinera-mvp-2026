import { describe, it, expect, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mockApiPatch, mockApiPost, mockSetLocale, mockSetThemeMode } from '../../setup'
import { useAuthStore } from '~/stores/auth'

const publicUser = (overrides: Record<string, unknown> = {}) => ({
  id: 'user-1', email: 'a@b.com', name: 'Alice', role: 'user',
  language: 'en', theme: 'dark', hasSeenWalkthrough: false, ...overrides,
})

describe('useAuthStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    mockApiPatch.mockClear()
    mockApiPost.mockClear()
    mockSetLocale.mockClear()
    mockSetThemeMode.mockClear()
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
    it('re-hydrates the user and syncs locale + theme when the backend returns one', async () => {
      const store = useAuthStore()
      mockApiPost.mockResolvedValue({
        data: { success: true, data: { token: 'fresh-token', user: publicUser({ language: 'pt', theme: 'light' }) } },
      })

      const ok = await store.tryRefresh()

      expect(ok).toBe(true)
      expect(store.token).toBe('fresh-token')
      expect(store.user?.language).toBe('pt')
      expect(mockSetLocale).toHaveBeenCalledWith('pt')
      expect(mockSetThemeMode).toHaveBeenCalledWith('light')
    })

    it('still yields a valid session (no throw) when the backend only returns a token', async () => {
      const store = useAuthStore()
      mockApiPost.mockResolvedValue({ data: { success: true, data: { token: 'fresh-token' } } })

      const ok = await store.tryRefresh()

      expect(ok).toBe(true)
      expect(store.token).toBe('fresh-token')
    })

    it('clears the session and returns false on a network error', async () => {
      const store = useAuthStore()
      store.user = publicUser()
      mockApiPost.mockRejectedValue(new Error('offline'))

      const ok = await store.tryRefresh()

      expect(ok).toBe(false)
      expect(store.token).toBeNull()
      expect(store.user).toBeNull()
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

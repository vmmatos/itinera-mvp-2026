import { describe, it, expect, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mockApiPatch } from '../../setup'
import { useAuthStore } from '~/stores/auth'

describe('useAuthStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    mockApiPatch.mockClear()
  })

  describe('completeWalkthrough()', () => {
    it('PATCHes the walkthrough endpoint and updates the user flag from the response', async () => {
      const store = useAuthStore()
      store.user = {
        id: 'user-1', email: 'a@b.com', name: 'Alice', role: 'user', language: 'en', hasSeenWalkthrough: false,
      }
      mockApiPatch.mockResolvedValue({
        data: { success: true, data: { id: 'user-1', email: 'a@b.com', name: 'Alice', role: 'user', language: 'en', hasSeenWalkthrough: true } },
      })

      await store.completeWalkthrough()

      expect(mockApiPatch).toHaveBeenCalledWith('/api/auth/me/walkthrough', {})
      expect(store.user?.hasSeenWalkthrough).toBe(true)
    })

    it('does not throw when there is no current user', async () => {
      const store = useAuthStore()
      store.user = null
      mockApiPatch.mockResolvedValue({
        data: { success: true, data: { id: 'user-1', email: 'a@b.com', name: 'Alice', role: 'user', language: 'en', hasSeenWalkthrough: true } },
      })

      await expect(store.completeWalkthrough()).resolves.toBeUndefined()
      expect(store.user).toBeNull()
    })
  })
})

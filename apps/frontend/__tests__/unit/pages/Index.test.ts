import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { authStoreMock, mockNavigateTo } from '../../setup'
import Index from '~/pages/index.vue'

// index.vue puts its redirect in an inline route middleware inside
// definePageMeta; capture that arg so we can invoke the middleware directly.
let meta: { middleware?: () => unknown } = {}

beforeEach(() => {
  meta = {}
  mockNavigateTo.mockClear()
  ;(globalThis as Record<string, unknown>).definePageMeta = vi.fn((m: typeof meta) => { meta = m })
  mount(Index, { global: { stubs: { NuxtLink: true } } })
})

describe('index page redirect', () => {
  it('sends an authenticated visitor to the dashboard', () => {
    authStoreMock.isAuthenticated = true

    meta.middleware?.()

    expect(mockNavigateTo).toHaveBeenCalledWith('/dashboard', { replace: true })
  })

  it('sends an anonymous visitor to login', () => {
    authStoreMock.isAuthenticated = false

    meta.middleware?.()

    expect(mockNavigateTo).toHaveBeenCalledWith('/auth/login', { replace: true })
  })
})

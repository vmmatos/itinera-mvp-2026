import { describe, it, expect, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { authStoreMock, mockCompleteWalkthrough } from '../../setup'
import { useWalkthroughStore } from '~/stores/walkthrough'

describe('useWalkthroughStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    mockCompleteWalkthrough.mockClear()
    authStoreMock.user = {
      id: 'user-1', name: 'Test User', email: 'test@test.com', role: 'user',
      language: 'en', theme: 'dark', hasSeenWalkthrough: false,
    }
  })

  // ── happy path ──────────────────────────────────────────────

  it('is active when the user is loaded and has not seen the walkthrough', () => {
    authStoreMock.user.hasSeenWalkthrough = false
    const store = useWalkthroughStore()

    expect(store.active).toBe(true)
  })

  it('is inactive when the user has already seen the walkthrough', () => {
    authStoreMock.user.hasSeenWalkthrough = true
    const store = useWalkthroughStore()

    expect(store.active).toBe(false)
  })

  it('is inactive while the user has not hydrated yet (no premature tour)', () => {
    // The store can be instantiated before a silent token refresh populates the
    // user. The old snapshot (`ref(!user?.hasSeenWalkthrough)`) latched `true`
    // here; the derived version must stay off until the user is known.
    authStoreMock.user = null as unknown as typeof authStoreMock.user
    const store = useWalkthroughStore()

    expect(store.active).toBe(false)
  })

  it('skip() deactivates and persists completion server-side', async () => {
    const store = useWalkthroughStore()
    await store.skip()

    expect(store.active).toBe(false)
    expect(mockCompleteWalkthrough).toHaveBeenCalledTimes(1)
  })

  it('complete() deactivates and persists completion server-side', async () => {
    const store = useWalkthroughStore()
    await store.complete()

    expect(store.active).toBe(false)
    expect(mockCompleteWalkthrough).toHaveBeenCalledTimes(1)
  })

  it('restart() forces the tour on even when the user has already seen it', () => {
    authStoreMock.user.hasSeenWalkthrough = true
    const store = useWalkthroughStore()
    expect(store.active).toBe(false)

    store.restart()

    expect(store.active).toBe(true)
  })

  it('skip() after restart() wins — session override goes back to dismissed', async () => {
    authStoreMock.user.hasSeenWalkthrough = true
    const store = useWalkthroughStore()
    store.restart()
    expect(store.active).toBe(true)

    await store.skip()

    expect(store.active).toBe(false)
  })
})

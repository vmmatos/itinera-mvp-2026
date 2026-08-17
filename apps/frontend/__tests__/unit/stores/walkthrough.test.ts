import { describe, it, expect, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { authStoreMock, mockCompleteWalkthrough } from '../../setup'
import { useWalkthroughStore } from '~/stores/walkthrough'

describe('useWalkthroughStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    mockCompleteWalkthrough.mockClear()
    authStoreMock.user.hasSeenWalkthrough = false
  })

  // ── happy path ──────────────────────────────────────────────

  it('is active by default when the user has not seen the walkthrough', () => {
    authStoreMock.user.hasSeenWalkthrough = false
    const store = useWalkthroughStore()

    expect(store.active).toBe(true)
  })

  it('is inactive when the user has already seen the walkthrough', () => {
    authStoreMock.user.hasSeenWalkthrough = true
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

  it('restart() reactivates the tour', () => {
    authStoreMock.user.hasSeenWalkthrough = true
    const store = useWalkthroughStore()
    expect(store.active).toBe(false)

    store.restart()

    expect(store.active).toBe(true)
  })
})

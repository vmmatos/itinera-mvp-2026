import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ref, nextTick } from 'vue'
import type { AgentStreamEvent } from '~/types/index'

// useAgentStream relies on Nuxt auto-imports; shim them before importing
// @ts-expect-error global shim
globalThis.useRuntimeConfig = vi.fn(() => ({ public: { wsUrl: 'ws://localhost:3009' } }))

// Import AFTER shims are in place
const { useAgentStream } = await import('~/composables/useAgentStream')

// ── SSE stream helpers ─────────────────────────────────────────

function sseChunk(...events: AgentStreamEvent[]): Uint8Array {
  const lines = events
    .map(
      (e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`,
    )
    .join('')
  return new TextEncoder().encode(lines)
}

function makeFetchMock(chunks: Uint8Array[], status = 200) {
  let chunkIndex = 0
  const reader = {
    read: vi.fn(async () => {
      if (chunkIndex < chunks.length) {
        return { done: false, value: chunks[chunkIndex++] }
      }
      return { done: true, value: undefined }
    }),
    releaseLock: vi.fn(),
  }
  return vi.fn().mockResolvedValue({
    ok: status === 200,
    status,
    body: { getReader: () => reader },
  })
}

describe('useAgentStream', () => {
  let originalFetch: typeof fetch
  let originalLocalStorage: Storage

  beforeEach(() => {
    originalFetch = globalThis.fetch
    originalLocalStorage = globalThis.localStorage
    // @ts-expect-error stub
    globalThis.localStorage = { getItem: vi.fn(() => 'test-jwt-token') }
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    globalThis.localStorage = originalLocalStorage
    vi.restoreAllMocks()
  })

  // ── Happy path ─────────────────────────────────────────────────

  it('parses SSE events and prepends them (newest first)', async () => {
    const event1: AgentStreamEvent = {
      tripId: 'trip-1', type: 'propose', agent: 'alice',
      round: 1, timestamp: '2026-01-01T10:00:00Z', content: {},
    }
    const event2: AgentStreamEvent = {
      tripId: 'trip-1', type: 'propose', agent: 'bob',
      round: 1, timestamp: '2026-01-01T10:00:01Z', content: {},
    }

    globalThis.fetch = makeFetchMock([sseChunk(event1), sseChunk(event2)])

    const tripId = ref<string | null>('trip-1')
    const { events, connected } = useAgentStream(tripId)

    await nextTick()
    await new Promise((r) => setTimeout(r, 50))

    expect(events.value.length).toBe(2)
    expect(events.value[0].agent).toBe('bob')
    expect(events.value[1].agent).toBe('alice')
    expect(connected.value).toBe(false)
  })

  it('ignores events for a different tripId', async () => {
    const foreignEvent: AgentStreamEvent = {
      tripId: 'other-trip', type: 'propose', agent: 'carlos',
      round: 1, timestamp: '2026-01-01T10:00:00Z', content: {},
    }

    globalThis.fetch = makeFetchMock([sseChunk(foreignEvent)])

    const tripId = ref<string | null>('trip-1')
    const { events } = useAgentStream(tripId)

    await nextTick()
    await new Promise((r) => setTimeout(r, 50))

    expect(events.value).toHaveLength(0)
  })

  // ── Error scenarios ────────────────────────────────────────────

  it('schedules reconnect when fetch throws (network error)', async () => {
    vi.useFakeTimers()
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'))

    const tripId = ref<string | null>('trip-1')
    useAgentStream(tripId)

    // Let the rejected fetch propagate
    await Promise.resolve()
    await Promise.resolve()

    // scheduleReconnect should have queued a 3s timer
    expect(vi.getTimerCount()).toBeGreaterThan(0)

    vi.useRealTimers()
  })

  it('schedules reconnect when server returns non-200', async () => {
    vi.useFakeTimers()
    globalThis.fetch = makeFetchMock([], 500)

    const tripId = ref<string | null>('trip-1')
    useAgentStream(tripId)

    await Promise.resolve()
    await Promise.resolve()

    expect(vi.getTimerCount()).toBeGreaterThan(0)

    vi.useRealTimers()
  })

  it('does not connect when tripId is null', () => {
    const fetchSpy = vi.fn()
    globalThis.fetch = fetchSpy

    const tripId = ref<string | null>(null)
    useAgentStream(tripId)

    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('reconnects when tripId changes', async () => {
    const fetchSpy = makeFetchMock([])
    globalThis.fetch = fetchSpy

    const tripId = ref<string | null>('trip-1')
    useAgentStream(tripId)

    await nextTick()
    await new Promise((r) => setTimeout(r, 20))

    tripId.value = 'trip-2'
    await nextTick()
    await new Promise((r) => setTimeout(r, 20))

    expect(fetchSpy).toHaveBeenCalledTimes(2)
    const secondCall = fetchSpy.mock.calls[1][0] as string
    expect(secondCall).toContain('trip-2')
  })
})

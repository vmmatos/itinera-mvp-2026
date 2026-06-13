import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ref, nextTick } from 'vue'
import type { TripDebugData } from '~/types/index'

// Shim Nuxt auto-imports before importing the composable
const mockGet = vi.fn()
// @ts-expect-error global shim
globalThis.useApi = vi.fn(() => ({ get: mockGet }))
// @ts-expect-error global shim
globalThis.useRuntimeConfig = vi.fn(() => ({ public: { apiBase: 'http://localhost' } }))
const { useAdminDebug } = await import('~/composables/useAdminDebug')

// ── Fixtures ──────────────────────────────────────────────────

const TRIP_ID = '00000000-0000-0000-0000-000000000001'

function makeDebugData(overrides: Partial<TripDebugData> = {}): TripDebugData {
  return {
    id: TRIP_ID,
    name: 'Sintra Debug',
    status: 'confirmed',
    region: 'europe',
    startDate: '2026-07-01',
    endDate: '2026-07-03',
    budgetTotal: 600,
    budgetCurrency: 'EUR',
    createdAt: '2026-06-01T10:00:00Z',
    updatedAt: '2026-06-01T11:00:00Z',
    proposals: [],
    agentLogs: [],
    metrics: [],
    scores: [],
    ...overrides,
  }
}

describe('useAdminDebug', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ── Happy path ─────────────────────────────────────────────

  it('fetches debug data on mount and populates data ref', async () => {
    const debugData = makeDebugData()
    mockGet.mockResolvedValueOnce({ data: { success: true, data: debugData } })

    const tripId = ref<string | null>(TRIP_ID)
    const { data, loading, error } = useAdminDebug(tripId)

    expect(loading.value).toBe(true)

    await nextTick()
    await new Promise((r) => setTimeout(r, 20))

    expect(loading.value).toBe(false)
    expect(error.value).toBeNull()
    expect(data.value).toEqual(debugData)
    expect(mockGet).toHaveBeenCalledWith(`/api/v1/trips/${TRIP_ID}?view=debug`)
  })

  it('includes proposals, agentLogs, metrics, scores in response', async () => {
    const proposals = [{ id: 'p1', round: 1, agent: 'alice', action: 'propose', content: {}, createdAt: '2026-06-01T10:00:00Z' }]
    const agentLogs = [{ id: 'l1', agent: 'alice', round: 1, action: 'propose', latencyMs: 320, tokensUsed: 1200, createdAt: '2026-06-01T10:00:00Z' }]
    const debugData = makeDebugData({ proposals: proposals as never, agentLogs: agentLogs as never })
    mockGet.mockResolvedValueOnce({ data: { success: true, data: debugData } })

    const tripId = ref<string | null>(TRIP_ID)
    const { data } = useAdminDebug(tripId)

    await nextTick()
    await new Promise((r) => setTimeout(r, 20))

    expect(data.value?.proposals).toHaveLength(1)
    expect(data.value?.agentLogs).toHaveLength(1)
    expect(data.value?.agentLogs[0].latencyMs).toBe(320)
  })

  it('calls refresh() and re-fetches data', async () => {
    const first = makeDebugData({ name: 'First' })
    const second = makeDebugData({ name: 'Second' })
    mockGet.mockResolvedValueOnce({ data: { success: true, data: first } })
    mockGet.mockResolvedValueOnce({ data: { success: true, data: second } })

    const tripId = ref<string | null>(TRIP_ID)
    const { data, refresh } = useAdminDebug(tripId)

    await nextTick()
    await new Promise((r) => setTimeout(r, 20))
    expect(data.value?.name).toBe('First')

    await refresh()
    expect(data.value?.name).toBe('Second')
    expect(mockGet).toHaveBeenCalledTimes(2)
  })

  it('re-fetches when tripId changes', async () => {
    const ID_A = '00000000-0000-0000-0000-aaaaaaaaaaaa'
    const ID_B = '00000000-0000-0000-0000-bbbbbbbbbbbb'
    const first = makeDebugData({ id: ID_A, name: 'A' })
    const second = makeDebugData({ id: ID_B, name: 'B' })
    mockGet.mockResolvedValueOnce({ data: { success: true, data: first } })
    mockGet.mockResolvedValueOnce({ data: { success: true, data: second } })

    const tripId = ref<string | null>(ID_A)
    const { data } = useAdminDebug(tripId)

    await nextTick()
    await new Promise((r) => setTimeout(r, 20))
    expect(data.value?.name).toBe('A')

    tripId.value = ID_B
    await nextTick()
    await new Promise((r) => setTimeout(r, 20))

    expect(data.value?.name).toBe('B')
    expect(mockGet).toHaveBeenCalledWith(`/api/v1/trips/${ID_B}?view=debug`)
  })

  // ── Error scenarios ────────────────────────────────────────

  it('sets error.value when API throws', async () => {
    mockGet.mockRejectedValueOnce(new Error('Network error'))

    const tripId = ref<string | null>(TRIP_ID)
    const { data, loading, error } = useAdminDebug(tripId)

    await nextTick()
    await new Promise((r) => setTimeout(r, 20))

    expect(loading.value).toBe(false)
    expect(data.value).toBeNull()
    expect(error.value).toBe('Network error')
  })

  it('sets generic error when non-Error thrown', async () => {
    mockGet.mockRejectedValueOnce('boom')

    const tripId = ref<string | null>(TRIP_ID)
    const { error } = useAdminDebug(tripId)

    await nextTick()
    await new Promise((r) => setTimeout(r, 20))

    expect(error.value).toBe('Failed to load debug data')
  })

  it('does not fetch when tripId is null', () => {
    const tripId = ref<string | null>(null)
    useAdminDebug(tripId)

    expect(mockGet).not.toHaveBeenCalled()
  })

  it('clears previous error on successful re-fetch', async () => {
    mockGet.mockRejectedValueOnce(new Error('First fail'))
    mockGet.mockResolvedValueOnce({ data: { success: true, data: makeDebugData() } })

    const tripId = ref<string | null>(TRIP_ID)
    const { error, refresh } = useAdminDebug(tripId)

    await nextTick()
    await new Promise((r) => setTimeout(r, 20))
    expect(error.value).toBe('First fail')

    await refresh()
    expect(error.value).toBeNull()
  })
})

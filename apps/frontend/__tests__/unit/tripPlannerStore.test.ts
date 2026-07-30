import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

// useApi is shimmed as a global in __tests__/setup.ts
// We override per test to control return values

import { useTripPlannerStore } from '~/stores/tripPlanner'
import type { CreateTripInput } from '~/types/index'

const setApiMocks = (getMock: ReturnType<typeof vi.fn>, postMock: ReturnType<typeof vi.fn>) => {
  ;(globalThis as Record<string, unknown>).useApi = vi.fn(() => ({
    get: getMock,
    post: postMock,
  }))
}

const MOCK_TRIPS = [
  {
    id: 'trip-1',
    name: 'Cusco run',
    status: 'draft' as const,
    region: 'Peru',
    startDate: '2026-06-12',
    endDate: '2026-06-19',
    budgetTotal: 4800,
    budgetCurrency: 'USD',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  },
]

const MOCK_INPUT: CreateTripInput = {
  name: 'Cusco run',
  region: 'Peru',
  startDate: '2026-06-12',
  endDate: '2026-06-19',
  budgetTotal: 4800,
  budgetCurrency: 'USD',
  travellers: [
    {
      userId: 'user-1',
      preferences: {
        persona: 'culture',
        flexibility: 'medium',
        pace: 'medium',
        dietary: [],
        constraints: [],
        mustHaves: [],
        avoids: [],
      },
    },
  ],
}

const LS_KEY = 'itinera_last_input'

describe('useTripPlannerStore', () => {
  let mockGet:  ReturnType<typeof vi.fn>
  let mockPost: ReturnType<typeof vi.fn>

  beforeEach(() => {
    setActivePinia(createPinia())
    mockGet  = vi.fn()
    mockPost = vi.fn()
    setApiMocks(mockGet, mockPost)
    localStorage.clear()
  })

  afterEach(() => {
    localStorage.clear()
  })

  // ── fetchTrips ──────────────────────────────────────────────

  describe('fetchTrips', () => {
    it('sets trips on success', async () => {
      mockGet.mockResolvedValueOnce({ data: { success: true, data: MOCK_TRIPS } })

      const store = useTripPlannerStore()
      await store.fetchTrips()

      expect(store.trips).toEqual(MOCK_TRIPS)
      expect(store.loading).toBe(false)
      expect(store.error).toBeNull()
    })

    it('sets error and clears loading on API failure', async () => {
      mockGet.mockRejectedValueOnce(new Error('Network error'))

      const store = useTripPlannerStore()
      await store.fetchTrips()

      expect(store.trips).toHaveLength(0)
      expect(store.error).toBe('Network error')
      expect(store.loading).toBe(false)
    })

    it('sets generic error message when a non-Error is thrown', async () => {
      mockGet.mockRejectedValueOnce('unexpected')

      const store = useTripPlannerStore()
      await store.fetchTrips()

      expect(store.error).toBe('Failed to load trips')
    })
  })

  // ── createTrip ──────────────────────────────────────────────

  describe('createTrip', () => {
    it('returns tripId and refreshes trips list on success', async () => {
      mockPost.mockResolvedValueOnce({ data: { success: true, data: { tripId: 'new-trip-123' } } })
      mockGet.mockResolvedValueOnce({ data: { success: true, data: MOCK_TRIPS } })

      const store = useTripPlannerStore()
      const tripId = await store.createTrip(MOCK_INPUT)

      expect(tripId).toBe('new-trip-123')
      expect(mockPost).toHaveBeenCalledWith('/api/v1/trips', MOCK_INPUT)
      expect(mockGet).toHaveBeenCalledWith('/api/v1/trips')
      expect(store.loading).toBe(false)
      expect(store.error).toBeNull()
    })

    it('sets error, re-throws, and clears loading on API failure', async () => {
      mockPost.mockRejectedValueOnce(new Error('Validation failed'))

      const store = useTripPlannerStore()
      await expect(store.createTrip(MOCK_INPUT)).rejects.toThrow('Validation failed')

      expect(store.error).toBe('Validation failed')
      expect(store.loading).toBe(false)
    })

    it('does not call fetchTrips when POST fails', async () => {
      mockPost.mockRejectedValueOnce(new Error('Server error'))

      const store = useTripPlannerStore()
      await store.createTrip(MOCK_INPUT).catch(() => undefined)

      expect(mockGet).not.toHaveBeenCalled()
    })
  })

  // ── clearError ──────────────────────────────────────────────

  describe('clearError', () => {
    it('resets error to null', async () => {
      mockGet.mockRejectedValueOnce(new Error('Some error'))

      const store = useTripPlannerStore()
      await store.fetchTrips()
      expect(store.error).not.toBeNull()

      store.clearError()
      expect(store.error).toBeNull()
    })
  })

  // ── setCurrentTrip ──────────────────────────────────────────

  describe('setCurrentTrip', () => {
    it('sets and clears the current trip', () => {
      const store = useTripPlannerStore()
      store.setCurrentTrip(MOCK_TRIPS[0])
      expect(store.currentTrip).toEqual(MOCK_TRIPS[0])

      store.setCurrentTrip(null)
      expect(store.currentTrip).toBeNull()
    })
  })

  // ── setLastInput ─────────────────────────────────────────────

  describe('setLastInput', () => {
    it('sets lastInput state and writes to localStorage', () => {
      const store = useTripPlannerStore()
      store.setLastInput(MOCK_INPUT)

      expect(store.lastInput).toEqual(MOCK_INPUT)
      expect(localStorage.getItem(LS_KEY)).toBe(JSON.stringify(MOCK_INPUT))
    })

    it('overwrites a previously stored value', () => {
      const store = useTripPlannerStore()
      store.setLastInput(MOCK_INPUT)

      const updated: CreateTripInput = { ...MOCK_INPUT, name: 'Updated trip' }
      store.setLastInput(updated)

      expect(store.lastInput?.name).toBe('Updated trip')
      expect(JSON.parse(localStorage.getItem(LS_KEY) ?? '{}')).toMatchObject({ name: 'Updated trip' })
    })
  })

  // ── clearLastInput ───────────────────────────────────────────

  describe('clearLastInput', () => {
    it('nulls lastInput and removes localStorage key', () => {
      const store = useTripPlannerStore()
      store.setLastInput(MOCK_INPUT)
      expect(store.lastInput).not.toBeNull()

      store.clearLastInput()

      expect(store.lastInput).toBeNull()
      expect(localStorage.getItem(LS_KEY)).toBeNull()
    })
  })

  // ── localStorage rehydration ─────────────────────────────────

  describe('localStorage rehydration', () => {
    it('pre-populates lastInput from localStorage on store init', () => {
      localStorage.setItem(LS_KEY, JSON.stringify(MOCK_INPUT))

      // Fresh store — reads from localStorage during defineStore init
      const store = useTripPlannerStore()

      expect(store.lastInput).toEqual(MOCK_INPUT)
    })

    it('starts with null lastInput when localStorage is empty', () => {
      const store = useTripPlannerStore()
      expect(store.lastInput).toBeNull()
    })

    it('returns null when localStorage contains malformed JSON', () => {
      localStorage.setItem(LS_KEY, 'not-valid-json{{{')
      const store = useTripPlannerStore()
      expect(store.lastInput).toBeNull()
    })
  })

  // ── createTrip saves lastInput before API call ───────────────

  describe('createTrip saves lastInput', () => {
    it('writes lastInput to localStorage before the POST request', async () => {
      const callOrder: string[] = []

      const origSetItem = localStorage.setItem.bind(localStorage)
      vi.spyOn(localStorage, 'setItem').mockImplementation((key, value) => {
        if (key === LS_KEY) callOrder.push('localStorage')
        origSetItem(key, value)
      })

      mockPost.mockImplementation(async () => {
        callOrder.push('post')
        return { data: { success: true, data: { tripId: 'new-id' } } }
      })
      mockGet.mockResolvedValueOnce({ data: { success: true, data: MOCK_TRIPS } })

      const store = useTripPlannerStore()
      await store.createTrip(MOCK_INPUT)

      expect(callOrder[0]).toBe('localStorage')
      expect(callOrder[1]).toBe('post')

      vi.restoreAllMocks()
    })

    it('preserves lastInput even when the API call fails', async () => {
      mockPost.mockRejectedValueOnce(new Error('Server error'))

      const store = useTripPlannerStore()
      await store.createTrip(MOCK_INPUT).catch(() => undefined)

      expect(store.lastInput).toEqual(MOCK_INPUT)
    })
  })
})

import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { Trip, CreateTripInput } from '~/types/index'

const LS_KEY = 'itinera_last_input'

const readLastInput = (): CreateTripInput | null => {
  try {
    const raw = localStorage.getItem(LS_KEY)
    return raw ? (JSON.parse(raw) as CreateTripInput) : null
  } catch {
    return null
  }
}

const writeLastInput = (input: CreateTripInput): void => {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(input))
  } catch { /* quota or SSR — silently skip */ }
}

const removeLastInput = (): void => {
  try {
    localStorage.removeItem(LS_KEY)
  } catch { /* SSR — silently skip */ }
}

const _extractMessage = (err: unknown, fallback: string): string => {
  if (err && typeof err === 'object' && 'response' in err) {
    const response = (err as { response?: { data?: { error?: { message?: string } } } }).response
    return response?.data?.error?.message ?? fallback
  }
  return err instanceof Error ? err.message : fallback
}

export const useTripPlannerStore = defineStore('tripPlanner', () => {
  const api = useApi()
  const trips = ref<Trip[]>([])
  const currentTrip = ref<Trip | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)
  const lastInput = ref<CreateTripInput | null>(readLastInput())

  const fetchTrips = async (): Promise<void> => {
    loading.value = true
    error.value = null
    try {
      const { data } = await api.get<{ success: true; data: Trip[] }>('/api/v1/trips')
      trips.value = data.data
    } catch (err: unknown) {
      error.value = _extractMessage(err, 'Failed to load trips')
    } finally {
      loading.value = false
    }
  }

  // Once the user has actually shipped a trip they know the product — retire
  // the walkthrough even if they never finished (or ever triggered) the
  // coach-marks. Best-effort: a failed PATCH must never block trip creation.
  const markWalkthroughSeen = async (): Promise<void> => {
    try {
      const auth = useAuthStore()
      if (auth.user && !auth.user.hasSeenWalkthrough) await auth.completeWalkthrough()
    } catch { /* best-effort */ }
  }

  const createTrip = async (input: CreateTripInput): Promise<string> => {
    loading.value = true
    error.value = null
    setLastInput(input)
    try {
      const { data } = await api.post<{ success: true; data: { tripId: string } }>('/api/v1/trips', input)
      await fetchTrips()
      await markWalkthroughSeen()
      return data.data.tripId
    } catch (err: unknown) {
      error.value = _extractMessage(err, 'Failed to create trip')
      throw err
    } finally {
      loading.value = false
    }
  }

  const setCurrentTrip = (trip: Trip | null): void => {
    currentTrip.value = trip
  }

  const setLastInput = (input: CreateTripInput): void => {
    lastInput.value = input
    writeLastInput(input)
  }

  const clearLastInput = (): void => {
    lastInput.value = null
    removeLastInput()
  }

  const clearError = (): void => {
    error.value = null
  }

  return {
    trips,
    currentTrip,
    loading,
    error,
    lastInput,
    fetchTrips,
    createTrip,
    setCurrentTrip,
    setLastInput,
    clearLastInput,
    clearError,
  }
})

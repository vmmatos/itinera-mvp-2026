import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { Trip, CreateTripInput } from '~/types/index'

export const useTripPlannerStore = defineStore('tripPlanner', () => {
  const api = useApi()
  const trips = ref<Trip[]>([])
  const currentTrip = ref<Trip | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  const fetchTrips = async (): Promise<void> => {
    loading.value = true
    error.value = null
    try {
      const { data } = await api.get<{ success: true; data: Trip[] }>('/api/v1/trips')
      trips.value = data.data
    } catch (err: unknown) {
      error.value = err instanceof Error ? err.message : 'Failed to load trips'
    } finally {
      loading.value = false
    }
  }

  const createTrip = async (input: CreateTripInput): Promise<string> => {
    loading.value = true
    error.value = null
    try {
      const { data } = await api.post<{ success: true; data: { tripId: string } }>('/api/v1/trips', input)
      await fetchTrips()
      return data.data.tripId
    } catch (err: unknown) {
      error.value = err instanceof Error ? err.message : 'Failed to create trip'
      throw err
    } finally {
      loading.value = false
    }
  }

  const setCurrentTrip = (trip: Trip | null): void => {
    currentTrip.value = trip
  }

  const clearError = (): void => {
    error.value = null
  }

  return { trips, currentTrip, loading, error, fetchTrips, createTrip, setCurrentTrip, clearError }
})

import { ref, watch } from 'vue'
import type { Ref } from 'vue'
import type { TripDebugData } from '~/types/index'

export function useAdminDebug(tripId: Ref<string | null>) {
  const data = ref<TripDebugData | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  const refresh = async (): Promise<void> => {
    if (!tripId.value) return
    loading.value = true
    error.value = null
    try {
      const api = useApi()
      const res = await api.get<{ success: true; data: TripDebugData }>(
        `/api/v1/trips/${tripId.value}?view=debug`,
      )
      data.value = res.data.data
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : 'Failed to load debug data'
      data.value = null
    } finally {
      loading.value = false
    }
  }

  watch(tripId, refresh, { immediate: true })

  return { data, loading, error, refresh }
}

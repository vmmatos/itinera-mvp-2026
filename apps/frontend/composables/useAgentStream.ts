import { ref, watch, onUnmounted } from 'vue'
import type { Ref } from 'vue'
import type { AgentStreamEvent } from '~/types/index'

const RECONNECT_DELAY_MS = 3000

export function useAgentStream(tripId: Ref<string | null>, role?: string) {
  const events = ref<AgentStreamEvent[]>([])
  const connected = ref(false)
  const authStore = useAuthStore()

  let abortController: AbortController | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let destroyed = false

  function getToken(): string | null {
    return authStore.token
  }

  async function connect(id: string): Promise<void> {
    if (destroyed) return

    abortController = new AbortController()
    const config = useRuntimeConfig()
    const wsUrl = (config.public.wsUrl as string).replace(/^ws/, 'http')
    const token = getToken()

    let response: Response
    try {
      const params = new URLSearchParams({ tripId: id })
      if (role) params.set('role', role)
      response = await fetch(`${wsUrl}/stream?${params.toString()}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        signal: abortController.signal,
      })
    } catch {
      scheduleReconnect(id)
      return
    }

    if (!response.ok || !response.body) {
      scheduleReconnect(id)
      return
    }

    connected.value = true
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        let eventType = ''
        let dataLine = ''

        for (const line of lines) {
          if (line.startsWith('event:')) {
            eventType = line.slice(6).trim()
          } else if (line.startsWith('data:')) {
            dataLine = line.slice(5).trim()
          } else if (line === '' && dataLine) {
            try {
              const parsed = JSON.parse(dataLine) as AgentStreamEvent
              if (parsed.tripId === id) {
                events.value = [parsed, ...events.value]
              }
            } catch { /* ignore malformed */ }
            eventType = ''
            dataLine = ''
          }
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return
    } finally {
      connected.value = false
      reader.releaseLock()
    }

    scheduleReconnect(id)
  }

  function scheduleReconnect(id: string): void {
    if (destroyed) return
    reconnectTimer = setTimeout(() => void connect(id), RECONNECT_DELAY_MS)
  }

  function disconnect(): void {
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    abortController?.abort()
    abortController = null
    connected.value = false
  }

  watch(
    tripId,
    (id) => {
      disconnect()
      events.value = []
      if (id) void connect(id)
    },
    { immediate: true },
  )

  onUnmounted(() => {
    destroyed = true
    disconnect()
  })

  return { events, connected }
}

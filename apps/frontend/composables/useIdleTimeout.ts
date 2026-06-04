import { onMounted, onUnmounted } from 'vue'

const IDLE_TIMEOUT_MS = 30 * 60 * 1000 // 30 minutes

export function useIdleTimeout(onTimeout: () => void): void {
  let timer: ReturnType<typeof setTimeout> | null = null

  const reset = (): void => {
    if (timer !== null) clearTimeout(timer)
    timer = setTimeout(onTimeout, IDLE_TIMEOUT_MS)
  }

  const events = ['mousedown', 'mousemove', 'keydown', 'scroll', 'touchstart', 'click']

  onMounted(() => {
    events.forEach((e) => window.addEventListener(e, reset, { passive: true }))
    reset()
  })

  onUnmounted(() => {
    events.forEach((e) => window.removeEventListener(e, reset))
    if (timer !== null) clearTimeout(timer)
  })
}

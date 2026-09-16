import { watch } from 'vue'
import { useIdle } from '@vueuse/core'

const IDLE_TIMEOUT_MS = 30 * 60 * 1000 // 30 minutes

export function useIdleTimeout(onTimeout: () => void): void {
  const { idle } = useIdle(IDLE_TIMEOUT_MS, {
    events: ['mousedown', 'mousemove', 'keydown', 'scroll', 'touchstart', 'click'],
  })

  watch(idle, (isIdle) => {
    if (isIdle) onTimeout()
  })
}

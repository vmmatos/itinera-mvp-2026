import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useWalkthroughStore = defineStore('walkthrough', () => {
  const authStore = useAuthStore()
  const active = ref(!authStore.user?.hasSeenWalkthrough)

  const skip = async (): Promise<void> => {
    active.value = false
    await authStore.completeWalkthrough()
  }

  const complete = async (): Promise<void> => {
    active.value = false
    await authStore.completeWalkthrough()
  }

  const restart = (): void => {
    active.value = true
  }

  return { active, skip, complete, restart }
})

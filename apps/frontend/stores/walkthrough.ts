import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export const useWalkthroughStore = defineStore('walkthrough', () => {
  const authStore = useAuthStore()

  // null  → follow the server flag on the user record
  // true  → force the tour on for this session ("How it works" replay)
  // false → dismissed for this session (skip/complete already persisted)
  const override = ref<boolean | null>(null)

  // Derived, not a snapshot: the user object hydrates asynchronously (login,
  // silent token refresh), so this must re-evaluate once it arrives instead of
  // latching whatever `authStore.user` was at store-init time.
  const active = computed<boolean>(() => {
    if (override.value !== null) return override.value
    return authStore.user != null && !authStore.user.hasSeenWalkthrough
  })

  const skip = async (): Promise<void> => {
    override.value = false
    await authStore.completeWalkthrough()
  }

  const complete = async (): Promise<void> => {
    override.value = false
    await authStore.completeWalkthrough()
  }

  const restart = (): void => {
    override.value = true
  }

  return { active, skip, complete, restart }
})

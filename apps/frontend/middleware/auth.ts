export default defineNuxtRouteMiddleware(async (to) => {
  if (to.path.startsWith('/auth')) return
  if (import.meta.server) return

  const authStore = useAuthStore()

  if (!authStore.token) {
    const ok = await authStore.tryRefresh()
    if (!ok) return navigateTo('/auth/login', { replace: true })
  }

  if (to.path.startsWith('/admin') && authStore.user?.role !== 'admin') {
    return navigateTo('/dashboard', { replace: true })
  }
})

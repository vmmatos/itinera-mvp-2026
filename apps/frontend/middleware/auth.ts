export default defineNuxtRouteMiddleware((to) => {
  if (to.path.startsWith('/auth')) return
  if (import.meta.server) return

  const authStore = useAuthStore()

  // `plugins/auth.client.ts` has already awaited a single silent refresh before
  // any middleware runs, so the token state here is settled — no refresh here.
  if (!authStore.token) {
    return navigateTo('/auth/login', { replace: true })
  }

  if (to.path.startsWith('/admin') && authStore.user?.role !== 'admin') {
    return navigateTo('/dashboard', { replace: true })
  }
})

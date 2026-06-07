export default defineNuxtRouteMiddleware((to) => {
  if (to.path.startsWith('/auth')) return
  if (import.meta.server) return

  const token = localStorage.getItem('itinera_token')
  if (!token) {
    return navigateTo('/auth/login', { replace: true })
  }

  if (to.path.startsWith('/admin')) {
    let role: string | null = null
    try {
      const stored = localStorage.getItem('itinera_user')
      if (stored) role = (JSON.parse(stored) as { role?: string }).role ?? null
    } catch { /* ignore */ }
    if (role !== 'admin') {
      return navigateTo('/dashboard', { replace: true })
    }
  }
})

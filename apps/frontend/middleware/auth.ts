export default defineNuxtRouteMiddleware((to) => {
  if (to.path.startsWith('/auth')) return

  const token = localStorage.getItem('itinera_token')
  if (!token) {
    return navigateTo('/auth/login', { replace: true })
  }
})

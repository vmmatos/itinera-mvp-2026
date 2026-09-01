/**
 * Single point of auth hydration on client startup.
 *
 * Token + user live in memory only (see `stores/auth.ts`), so every hard load
 * begins logged-out until the httpOnly `refresh_token` cookie is exchanged for a
 * fresh access token. Doing that here — in a blocking, default (non-parallel)
 * plugin — means route middleware and page `onMounted` all observe a settled
 * auth state, and there is exactly one `/api/auth/refresh` in flight on first
 * paint instead of several racing calls.
 */
export default defineNuxtPlugin(async () => {
  const auth = useAuthStore()
  if (!auth.token) {
    await auth.tryRefresh()
  }
})

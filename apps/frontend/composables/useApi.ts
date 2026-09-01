import axios from 'axios'
import type { AxiosInstance, InternalAxiosRequestConfig } from 'axios'
import { refreshSession } from '~/composables/useAuthRefresh'

export const useApi = (): AxiosInstance => {
  const config = useRuntimeConfig()
  const authStore = useAuthStore()

  const api = axios.create({
    baseURL: config.public.apiBase as string,
    headers: { 'Content-Type': 'application/json' },
    withCredentials: true, // send httpOnly refresh_token cookie
  })

  api.interceptors.request.use((cfg) => {
    const token = authStore.token
    if (token) {
      cfg.headers.Authorization = `Bearer ${token}`
    }
    return cfg
  })

  api.interceptors.response.use(
    (res) => res,
    async (err: unknown) => {
      const axiosErr = err as { response?: { status?: number }; config?: InternalAxiosRequestConfig & { _retry?: boolean } }
      const status = axiosErr.response?.status
      const originalConfig = axiosErr.config

      if (status === 401 && originalConfig && !originalConfig._retry) {
        originalConfig._retry = true

        // Shared with the startup plugin and any other concurrent 401 — one
        // POST /api/auth/refresh, everyone awaits it (see useAuthRefresh.ts).
        const outcome = await refreshSession()

        if (outcome.ok) {
          authStore.setSession({ token: outcome.token, user: outcome.user })
          originalConfig.headers.Authorization = `Bearer ${outcome.token}`
          return api(originalConfig)
        }

        if (outcome.reason === 'no-session') {
          authStore.clearSession()
          await navigateTo('/auth/login', { replace: true })
        }
        // transient: leave the session intact and let the caller surface its
        // own error — a blip on one request must not log the user out.
        return Promise.reject(err)
      }

      return Promise.reject(err)
    },
  )

  return api
}

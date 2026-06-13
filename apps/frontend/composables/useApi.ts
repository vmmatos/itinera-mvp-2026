import axios from 'axios'
import type { AxiosInstance, InternalAxiosRequestConfig } from 'axios'

let isRefreshing = false
let refreshQueue: Array<(token: string | null) => void> = []

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

        if (isRefreshing) {
          return new Promise<string | null>((resolve) => {
            refreshQueue.push(resolve)
          }).then((newToken) => {
            if (!newToken) return Promise.reject(err)
            originalConfig.headers.Authorization = `Bearer ${newToken}`
            return api(originalConfig)
          })
        }

        isRefreshing = true
        try {
          const resp = await axios.post<{ success: boolean; data: { token: string } }>(
            `${config.public.apiBase}/api/auth/refresh`,
            {},
            { withCredentials: true },
          )
          const newToken = resp.data.data.token
          authStore.updateToken(newToken)

          refreshQueue.forEach((cb) => cb(newToken))
          refreshQueue = []

          originalConfig.headers.Authorization = `Bearer ${newToken}`
          return api(originalConfig)
        } catch {
          refreshQueue.forEach((cb) => cb(null))
          refreshQueue = []
          authStore.clearSession()
          await navigateTo('/auth/login', { replace: true })
          return Promise.reject(err)
        } finally {
          isRefreshing = false
        }
      }

      return Promise.reject(err)
    },
  )

  return api
}

import axios from 'axios'
import type { AxiosInstance } from 'axios'

export const useApi = (): AxiosInstance => {
  const config = useRuntimeConfig()

  const api = axios.create({
    baseURL: config.public.apiUrl as string,
    headers: { 'Content-Type': 'application/json' },
  })

  api.interceptors.request.use((cfg) => {
    const token = localStorage.getItem('itinera_token')
    if (token) {
      cfg.headers.Authorization = `Bearer ${token}`
    }
    return cfg
  })

  api.interceptors.response.use(
    (res) => res,
    async (err: unknown) => {
      if (err && typeof err === 'object' && 'response' in err) {
        const status = (err as { response?: { status?: number } }).response?.status
        if (status === 401) {
          localStorage.removeItem('itinera_token')
          localStorage.removeItem('itinera_user')
          await navigateTo('/auth/login', { replace: true })
        }
      }
      return Promise.reject(err)
    },
  )

  return api
}

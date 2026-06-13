import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

interface AuthUser {
  id: string
  email: string
  name: string
  role: string
}

interface AuthResult {
  token: string
  user: AuthUser
}

export const useAuthStore = defineStore('auth', () => {
  // Token lives in memory only — never persisted to localStorage.
  // On page reload the middleware calls tryRefresh() to re-hydrate via httpOnly cookie.
  const token = ref<string | null>(null)
  const user = ref<AuthUser | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  const isAuthenticated = computed(() => !!token.value)
  const isAdmin = computed(() => user.value?.role === 'admin')

  const updateToken = (newToken: string): void => {
    token.value = newToken
  }

  const clearSession = (): void => {
    token.value = null
    user.value = null
  }

  /**
   * Attempt silent token refresh using the httpOnly refresh_token cookie.
   * Returns true if a new access token was obtained, false otherwise.
   * Called by the route middleware on every navigation when token is absent.
   */
  const tryRefresh = async (): Promise<boolean> => {
    try {
      const api = useApi()
      const { data } = await api.post<{ success: true; data: AuthResult }>('/api/auth/refresh', {})
      token.value = data.data.token
      user.value = data.data.user
      return true
    } catch {
      token.value = null
      user.value = null
      return false
    }
  }

  const setFromOAuth = (result: AuthResult): void => {
    _set(result)
  }

  const login = async (email: string, password: string): Promise<void> => {
    loading.value = true
    error.value = null
    try {
      const api = useApi()
      const { data } = await api.post<{ success: true; data: AuthResult }>('/api/auth/login', { email, password })
      _set(data.data)
      await navigateTo('/')
    } catch (err: unknown) {
      error.value = _extractMessage(err, 'Invalid credentials. Please try again.')
      throw err
    } finally {
      loading.value = false
    }
  }

  const register = async (email: string, password: string, name: string): Promise<void> => {
    loading.value = true
    error.value = null
    try {
      const api = useApi()
      const { data } = await api.post<{ success: true; data: AuthResult }>('/api/auth/register', { email, password, name })
      _set(data.data)
      await navigateTo('/')
    } catch (err: unknown) {
      error.value = _extractMessage(err, 'Registration failed. Please try again.')
      throw err
    } finally {
      loading.value = false
    }
  }

  const loginWithGoogle = (): void => {
    const config = useRuntimeConfig()
    window.location.href = `${config.public.apiBase}/api/auth/oauth2/google`
  }

  const logout = async (): Promise<void> => {
    try {
      const api = useApi()
      await api.post('/api/auth/logout')
    } catch { /* best-effort */ }
    token.value = null
    user.value = null
    await navigateTo('/auth/login', { replace: true })
  }

  const clearError = (): void => {
    error.value = null
  }

  const _set = (result: AuthResult): void => {
    token.value = result.token
    user.value = result.user
  }

  const _extractMessage = (err: unknown, fallback: string): string => {
    if (err && typeof err === 'object' && 'response' in err) {
      const response = (err as { response?: { data?: { error?: { message?: string } } } }).response
      return response?.data?.error?.message ?? fallback
    }
    return err instanceof Error ? err.message : fallback
  }

  return {
    token,
    user,
    loading,
    error,
    isAuthenticated,
    isAdmin,
    updateToken,
    clearSession,
    tryRefresh,
    setFromOAuth,
    login,
    register,
    loginWithGoogle,
    logout,
    clearError,
  }
})

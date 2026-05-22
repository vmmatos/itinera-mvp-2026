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
  const token = ref<string | null>(null)
  const user = ref<AuthUser | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  const isAuthenticated = computed(() => !!token.value)
  const isAdmin = computed(() => user.value?.role === 'admin')

  const initFromStorage = (): void => {
    token.value = localStorage.getItem('itinera_token')
    const stored = localStorage.getItem('itinera_user')
    if (stored) {
      try { user.value = JSON.parse(stored) as AuthUser } catch { user.value = null }
    }
  }

  const setFromOAuth = (result: AuthResult): void => {
    _persist(result)
  }

  const login = async (email: string, password: string): Promise<void> => {
    loading.value = true
    error.value = null
    try {
      const api = useApi()
      const { data } = await api.post<{ success: true; data: AuthResult }>('/api/auth/login', { email, password })
      _persist(data.data)
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
      _persist(data.data)
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
    window.location.href = `${config.public.apiUrl}/api/auth/oauth2/google`
  }

  const logout = async (): Promise<void> => {
    token.value = null
    user.value = null
    localStorage.removeItem('itinera_token')
    localStorage.removeItem('itinera_user')
    await navigateTo('/auth/login', { replace: true })
  }

  const clearError = (): void => {
    error.value = null
  }

  const _persist = (result: AuthResult): void => {
    token.value = result.token
    user.value = result.user
    localStorage.setItem('itinera_token', result.token)
    localStorage.setItem('itinera_user', JSON.stringify(result.user))
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
    initFromStorage,
    setFromOAuth,
    login,
    register,
    loginWithGoogle,
    logout,
    clearError,
  }
})

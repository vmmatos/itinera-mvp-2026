import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { reactive } from 'vue'
import { createPinia } from 'pinia'
import Login from '~/pages/auth/login.vue'

const login = vi.fn()
const register = vi.fn()
const authStore = reactive({
  loading: false,
  error: null as string | null,
  login,
  register,
  loginWithGoogle: vi.fn(),
  clearError: vi.fn(() => { authStore.error = null }),
})

let query: Record<string, string> = {}

beforeEach(() => {
  login.mockReset()
  register.mockReset()
  authStore.clearError.mockClear()
  authStore.error = null
  query = {}
  ;(globalThis as Record<string, unknown>).useAuthStore = vi.fn(() => authStore)
  ;(globalThis as Record<string, unknown>).useRoute = vi.fn(() => ({ params: {}, query }))
})

const mountPage = () =>
  mount(Login, {
    global: {
      plugins: [createPinia()],
      stubs: { NuxtLink: { template: '<a><slot /></a>' }, AppLogo: true },
    },
  })

describe('auth/login page', () => {
  it('clears a stale store error on mount', () => {
    authStore.error = 'Invalid credentials. Please try again.'

    const wrapper = mountPage()

    expect(authStore.clearError).toHaveBeenCalled()
    expect(wrapper.find('.badge-red').exists()).toBe(false)
  })

  it('still shows the OAuth error from the route query', () => {
    query = { error: 'oauth_failed' }

    const wrapper = mountPage()

    expect(wrapper.find('.badge-red').text()).toContain('Google sign-in failed')
  })

  it('renders the mode tabs as classes with no inline style attribute', () => {
    const wrapper = mountPage()
    const firstTab = wrapper.findAll('.auth-tab')[0]

    expect(firstTab.classes()).toContain('auth-tab--active')
    expect(firstTab.attributes('style')).toBeUndefined()
  })

  it('rejects an invalid email locally without calling the store', async () => {
    const wrapper = mountPage()

    await wrapper.find('input[type="email"]').setValue('nope')
    await wrapper.find('form').trigger('submit.prevent')
    await flushPromises()

    expect(login).not.toHaveBeenCalled()
    expect(authStore.error).toBe('Enter a valid email address.')
  })

  it('submits valid credentials to the store', async () => {
    login.mockResolvedValue(undefined)
    const wrapper = mountPage()

    await wrapper.find('input[type="email"]').setValue('a@b.com')
    await wrapper.find('input[type="password"]').setValue('secret12')
    await wrapper.find('form').trigger('submit.prevent')
    await flushPromises()

    expect(login).toHaveBeenCalledWith('a@b.com', 'secret12')
  })
})

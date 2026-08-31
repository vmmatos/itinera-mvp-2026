import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { mockNavigateTo } from '../../setup'
import ResetPassword from '~/pages/auth/reset-password.vue'

const resetPassword = vi.fn()
const clearError = vi.fn()
const authStore = {
  loading: false,
  error: null as string | null,
  resetPassword,
  clearError,
}

beforeEach(() => {
  resetPassword.mockReset()
  clearError.mockReset()
  mockNavigateTo.mockClear()
  authStore.error = null
  ;(globalThis as Record<string, unknown>).useAuthStore = vi.fn(() => authStore)
  ;(globalThis as Record<string, unknown>).useHead = vi.fn()
})

const mountWithQuery = (query: Record<string, string>) => {
  ;(globalThis as Record<string, unknown>).useRoute = vi.fn(() => ({ query }))
  return mount(ResetPassword, {
    global: {
      plugins: [createPinia()],
      stubs: { NuxtLink: { template: '<a><slot /></a>' }, AppLogo: true },
    },
  })
}

describe('auth/reset-password page', () => {
  it('shows the invalid-link state when the token query param is missing', () => {
    const wrapper = mountWithQuery({})

    expect(wrapper.text()).toContain('Invalid reset link')
    expect(wrapper.find('form').exists()).toBe(false)
  })

  it('sets the no-referrer meta tag', () => {
    const useHead = (globalThis as Record<string, unknown>).useHead as ReturnType<typeof vi.fn>
    mountWithQuery({ token: 'abc' })

    expect(useHead).toHaveBeenCalledWith({
      meta: [{ name: 'referrer', content: 'no-referrer' }],
    })
  })

  it('blocks submission when the two passwords do not match', async () => {
    const wrapper = mountWithQuery({ token: 'abc' })

    const inputs = wrapper.findAll('input[type="password"]')
    await inputs[0].setValue('brand-new-pass')
    await inputs[1].setValue('different-pass')
    await wrapper.find('form').trigger('submit.prevent')
    await flushPromises()

    expect(resetPassword).not.toHaveBeenCalled()
    expect(authStore.error).toBe('Passwords do not match.')
  })

  it('blocks submission when the password is too short', async () => {
    const wrapper = mountWithQuery({ token: 'abc' })

    const inputs = wrapper.findAll('input[type="password"]')
    await inputs[0].setValue('short')
    await inputs[1].setValue('short')
    await wrapper.find('form').trigger('submit.prevent')
    await flushPromises()

    expect(resetPassword).not.toHaveBeenCalled()
    expect(authStore.error).toBe('Password must be at least 8 characters.')
  })

  it('resets the password and redirects to login on success', async () => {
    resetPassword.mockResolvedValue(undefined)
    const wrapper = mountWithQuery({ token: 'raw-token' })

    const inputs = wrapper.findAll('input[type="password"]')
    await inputs[0].setValue('brand-new-pass')
    await inputs[1].setValue('brand-new-pass')
    await wrapper.find('form').trigger('submit.prevent')
    await flushPromises()

    expect(resetPassword).toHaveBeenCalledWith('raw-token', 'brand-new-pass')
    expect(mockNavigateTo).toHaveBeenCalledWith('/auth/login?reset=success')
  })

  it('does not redirect when the reset call fails', async () => {
    resetPassword.mockRejectedValue(new Error('expired'))
    const wrapper = mountWithQuery({ token: 'raw-token' })

    const inputs = wrapper.findAll('input[type="password"]')
    await inputs[0].setValue('brand-new-pass')
    await inputs[1].setValue('brand-new-pass')
    await wrapper.find('form').trigger('submit.prevent')
    await flushPromises()

    expect(mockNavigateTo).not.toHaveBeenCalled()
  })
})

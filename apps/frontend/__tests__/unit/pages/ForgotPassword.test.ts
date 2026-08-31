import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia } from 'pinia'
import ForgotPassword from '~/pages/auth/forgot-password.vue'

const requestPasswordReset = vi.fn()
const clearError = vi.fn()
const authStore = {
  loading: false,
  error: null as string | null,
  requestPasswordReset,
  clearError,
}

beforeEach(() => {
  requestPasswordReset.mockReset()
  clearError.mockReset()
  authStore.error = null
  ;(globalThis as Record<string, unknown>).useAuthStore = vi.fn(() => authStore)
})

const mountPage = () =>
  mount(ForgotPassword, {
    global: {
      plugins: [createPinia()],
      stubs: { NuxtLink: { template: '<a><slot /></a>' }, AppLogo: true },
    },
  })

describe('auth/forgot-password page', () => {
  it('submits the email and then shows the generic confirmation panel', async () => {
    requestPasswordReset.mockResolvedValue(undefined)
    const wrapper = mountPage()

    await wrapper.find('input[type="email"]').setValue('alice@example.com')
    await wrapper.find('form').trigger('submit.prevent')
    await flushPromises()

    expect(requestPasswordReset).toHaveBeenCalledWith('alice@example.com')
    expect(wrapper.text()).toContain('Check your inbox')
    expect(wrapper.find('form').exists()).toBe(false)
  })

  it('rejects an invalid email locally without calling the store', async () => {
    const wrapper = mountPage()

    await wrapper.find('input[type="email"]').setValue('not-an-email')
    await wrapper.find('form').trigger('submit.prevent')
    await flushPromises()

    expect(requestPasswordReset).not.toHaveBeenCalled()
    expect(authStore.error).toBe('Enter a valid email address.')
  })

  it('stays on the form (no confirmation) when the request fails', async () => {
    requestPasswordReset.mockRejectedValue(new Error('boom'))
    const wrapper = mountPage()

    await wrapper.find('input[type="email"]').setValue('alice@example.com')
    await wrapper.find('form').trigger('submit.prevent')
    await flushPromises()

    expect(wrapper.text()).not.toContain('Check your inbox')
    expect(wrapper.find('form').exists()).toBe(true)
  })
})

import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { authStoreMock, mockUpdateLanguage } from '../setup'
import Settings from '~/pages/settings.vue'

const mountSettings = () =>
  mount(Settings, {
    global: {
      plugins: [createPinia()],
      stubs: { AppLogo: true, NuxtLink: true },
    },
  })

describe('settings.vue', () => {
  beforeEach(() => {
    mockUpdateLanguage.mockReset()
    authStoreMock.user = { id: 'user-1', name: 'Test User', email: 'test@test.com', role: 'user', language: 'en' }
  })

  // ── happy path ──────────────────────────────────────────────

  it('shows the current language as selected', () => {
    const wrapper = mountSettings()
    const select = wrapper.get('[data-testid="language-select"]')

    expect((select.element as HTMLSelectElement).value).toBe('en')
  })

  it('persists the new language and shows a saved confirmation on change', async () => {
    mockUpdateLanguage.mockResolvedValue(undefined)
    const wrapper = mountSettings()

    await wrapper.get('[data-testid="language-select"]').setValue('pt')

    expect(mockUpdateLanguage).toHaveBeenCalledWith('pt')
    expect(wrapper.find('[data-testid="settings-saved"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="settings-error"]').exists()).toBe(false)
  })

  // ── error path ──────────────────────────────────────────────

  it('shows an error and no saved confirmation when the update fails', async () => {
    mockUpdateLanguage.mockRejectedValue(new Error('network error'))
    const wrapper = mountSettings()

    await wrapper.get('[data-testid="language-select"]').setValue('pt')
    await Promise.resolve()

    expect(wrapper.find('[data-testid="settings-error"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="settings-saved"]').exists()).toBe(false)
  })
})

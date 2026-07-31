import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { authStoreMock, mockUpdateLanguage } from '../setup'
import LanguageSwitcher from '~/components/LanguageSwitcher.vue'

const mountSwitcher = () =>
  mount(LanguageSwitcher, {
    attachTo: document.body,
    global: { plugins: [createPinia()] },
  })

describe('LanguageSwitcher', () => {
  beforeEach(() => {
    mockUpdateLanguage.mockReset()
    authStoreMock.user = { id: 'user-1', name: 'Test User', email: 'test@test.com', role: 'user', language: 'en' }
  })

  // ── happy path ──────────────────────────────────────────────

  it('shows the current language flag and opens the menu on click', async () => {
    const wrapper = mountSwitcher()
    expect(wrapper.text()).toContain('🇬🇧')

    await wrapper.get('.lang-toggle').trigger('click')

    expect(wrapper.findAll('[role="option"]')).toHaveLength(2)
    wrapper.unmount()
  })

  it('calls updateLanguage and closes the menu when a language is selected', async () => {
    mockUpdateLanguage.mockResolvedValue(undefined)
    const wrapper = mountSwitcher()

    await wrapper.get('.lang-toggle').trigger('click')
    const options = wrapper.findAll('.lang-option')
    await options[1]!.trigger('click')

    expect(mockUpdateLanguage).toHaveBeenCalledWith('pt')
    expect(wrapper.find('[role="option"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('does not call updateLanguage when the current language is re-selected', async () => {
    const wrapper = mountSwitcher()

    await wrapper.get('.lang-toggle').trigger('click')
    const options = wrapper.findAll('.lang-option')
    await options[0]!.trigger('click')

    expect(mockUpdateLanguage).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('closes the menu on an outside click', async () => {
    const wrapper = mountSwitcher()
    await wrapper.get('.lang-toggle').trigger('click')
    expect(wrapper.find('[role="option"]').exists()).toBe(true)

    document.body.click()
    await wrapper.vm.$nextTick()

    expect(wrapper.find('[role="option"]').exists()).toBe(false)
    wrapper.unmount()
  })

  // ── error path ──────────────────────────────────────────────

  it('shows an inline error and keeps the previous language when the update fails', async () => {
    mockUpdateLanguage.mockRejectedValue(new Error('network error'))
    const wrapper = mountSwitcher()

    await wrapper.get('.lang-toggle').trigger('click')
    const options = wrapper.findAll('.lang-option')
    await options[1]!.trigger('click')
    await Promise.resolve()
    await wrapper.vm.$nextTick()

    expect(wrapper.find('[data-testid="lang-switcher-error"]').exists()).toBe(true)
    wrapper.unmount()
  })
})

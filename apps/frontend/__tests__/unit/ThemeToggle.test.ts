import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { themeStoreMock, mockToggleTheme, authStoreMock, mockUpdateTheme } from '../setup'
import ThemeToggle from '~/components/ThemeToggle.vue'

const mountToggle = () =>
  mount(ThemeToggle, {
    global: { plugins: [createPinia()] },
  })

describe('ThemeToggle', () => {
  beforeEach(() => {
    mockToggleTheme.mockClear()
    mockUpdateTheme.mockClear()
    themeStoreMock.isLight = false
    themeStoreMock.mode = 'dark'
    authStoreMock.isAuthenticated = true
  })

  // ── happy path ──────────────────────────────────────────────

  it('renders the moon glyph (switch-to-light affordance) in dark mode', () => {
    themeStoreMock.isLight = false
    const wrapper = mountToggle()

    expect(wrapper.attributes('aria-label')).toBe('Switch to light mode')
  })

  it('renders the sun glyph (switch-to-dark affordance) in light mode', () => {
    themeStoreMock.isLight = true
    const wrapper = mountToggle()

    expect(wrapper.attributes('aria-label')).toBe('Switch to dark mode')
  })

  it('calls toggle() exactly once on click', async () => {
    const wrapper = mountToggle()
    await wrapper.trigger('click')

    expect(mockToggleTheme).toHaveBeenCalledTimes(1)
  })

  it('persists the new mode server-side when the user is authenticated', async () => {
    themeStoreMock.mode = 'light'
    const wrapper = mountToggle()
    await wrapper.trigger('click')
    await Promise.resolve()

    expect(mockUpdateTheme).toHaveBeenCalledWith('light')
  })

  it('does not hit the API for a guest', async () => {
    authStoreMock.isAuthenticated = false
    const wrapper = mountToggle()
    await wrapper.trigger('click')
    await Promise.resolve()

    expect(mockToggleTheme).toHaveBeenCalledTimes(1)
    expect(mockUpdateTheme).not.toHaveBeenCalled()
  })

  // ── accessibility ───────────────────────────────────────────

  it('is a real <button> with an aria-label', () => {
    const wrapper = mountToggle()

    expect(wrapper.element.tagName).toBe('BUTTON')
    expect(wrapper.attributes('aria-label')).toBeTruthy()
  })
})

import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { themeStoreMock, mockToggleTheme } from '../setup'
import ThemeToggle from '~/components/ThemeToggle.vue'

const mountToggle = () =>
  mount(ThemeToggle, {
    global: { plugins: [createPinia()] },
  })

describe('ThemeToggle', () => {
  beforeEach(() => {
    mockToggleTheme.mockClear()
    themeStoreMock.isLight = false
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

  // ── accessibility ───────────────────────────────────────────

  it('is a real <button> with an aria-label', () => {
    const wrapper = mountToggle()

    expect(wrapper.element.tagName).toBe('BUTTON')
    expect(wrapper.attributes('aria-label')).toBeTruthy()
  })
})

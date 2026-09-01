import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import AuthLayout from '~/layouts/auth.vue'

describe('auth layout', () => {
  it('uses SSR-inlined component classes for the shell, not Tailwind utilities', () => {
    const wrapper = mount(AuthLayout, { slots: { default: '<p>x</p>' } })
    const root = wrapper.get('div')

    // Structure + forced-dark theming must land on first paint (before the
    // dev Tailwind layer is injected) — see globals.css `.auth-shell`.
    expect(root.classes()).toContain('auth-shell')
    expect(root.classes()).toContain('theme-force-dark')
    expect(root.classes()).not.toContain('min-h-screen')
    expect(root.classes()).not.toContain('flex')
  })
})

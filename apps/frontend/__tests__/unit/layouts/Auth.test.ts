import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import AuthLayout from '~/layouts/auth.vue'

const globalsCss = readFileSync(resolve(__dirname, '../../../assets/css/globals.css'), 'utf8')
const forceDarkBlock = globalsCss.slice(
  globalsCss.indexOf('.theme-force-dark {'),
  globalsCss.indexOf('}', globalsCss.indexOf('.theme-force-dark {')) + 1,
)

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

  it('restates the composed border/agent tokens so light mode cannot leak in', () => {
    // --hair etc. bake in --line-2 at :root; the forced-dark block must
    // redeclare them or a persisted light theme lightens the auth borders.
    for (const token of ['--hair:', '--hair-soft:', '--agent-1:', '--agent-4:']) {
      expect(forceDarkBlock).toContain(token)
    }
  })
})

import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import AppHeader from '~/components/AppHeader.vue'

describe('AppHeader', () => {
  it('always renders the logo, theme toggle and language switcher', () => {
    const wrapper = mount(AppHeader)
    expect(wrapper.findComponent({ name: 'AppLogo' }).exists()).toBe(true)
    expect(wrapper.findComponent({ name: 'ThemeToggle' }).exists()).toBe(true)
    expect(wrapper.findComponent({ name: 'LanguageSwitcher' }).exists()).toBe(true)
  })

  it('shows the sign-out button by default and emits signOut on click', async () => {
    const wrapper = mount(AppHeader)
    const btn = wrapper.find('[data-testid="sign-out-btn"]')
    expect(btn.exists()).toBe(true)

    await btn.trigger('click')
    expect(wrapper.emitted('signOut')).toHaveLength(1)
  })

  it('hides the sign-out button when show-sign-out is false', () => {
    const wrapper = mount(AppHeader, { props: { showSignOut: false } })
    expect(wrapper.find('[data-testid="sign-out-btn"]').exists()).toBe(false)
  })

  it('renders slotted page-specific links', () => {
    const wrapper = mount(AppHeader, {
      slots: { links: '<a data-testid="custom-link">Back</a>' },
    })
    expect(wrapper.find('[data-testid="custom-link"]').exists()).toBe(true)
  })

  it('keeps the full email in the DOM but bounds it visually with a truncate/max-width class', () => {
    const longEmail = 'a.very.long.mailbox.name.for.testing@some-example-domain.com'
    const wrapper = mount(AppHeader, { props: { email: longEmail } })
    const emailEl = wrapper.find('span.truncate')
    expect(emailEl.exists()).toBe(true)
    expect(emailEl.text()).toBe(longEmail)
    expect(emailEl.classes().join(' ')).toMatch(/max-w-\[/)
  })

  it('does not render an email span when no email is provided', () => {
    const wrapper = mount(AppHeader)
    expect(wrapper.find('span.truncate').exists()).toBe(false)
  })

  it('wraps header content instead of overflowing at narrow widths (structural check)', () => {
    const wrapper = mount(AppHeader, { props: { email: 'user@test.com' } })
    expect(wrapper.classes()).toContain('flex-wrap')
    const rightGroup = wrapper.find('.app-header-right')
    expect(rightGroup.classes()).toContain('flex-wrap')
  })
})

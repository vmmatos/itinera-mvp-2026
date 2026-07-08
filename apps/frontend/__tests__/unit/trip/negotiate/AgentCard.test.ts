import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import AgentCard from '~/components/trip/negotiate/AgentCard.vue'
import type { AgentCardState } from '~/types/index'

function agent(overrides: Partial<AgentCardState> = {}): AgentCardState {
  return { id: 'diana', color: 'magenta', role: 'traveller', state: 'idle', lastAction: null, proposalCount: 0, ...overrides }
}

describe('AgentCard', () => {
  it('shows idle status text and em-dash last action when idle', () => {
    const wrapper = mount(AgentCard, { props: { agent: agent() } })
    expect(wrapper.text()).toContain('idle · waiting on orchestrator')
    expect(wrapper.text()).toContain('—')
  })

  it('shows "thinking…" when thinking', () => {
    const wrapper = mount(AgentCard, { props: { agent: agent({ state: 'thinking' }) } })
    expect(wrapper.text()).toContain('thinking…')
  })

  it('shows "proposing…" when proposing', () => {
    const wrapper = mount(AgentCard, { props: { agent: agent({ state: 'proposing' }) } })
    expect(wrapper.text()).toContain('proposing…')
  })

  it('shows the last action text when set', () => {
    const wrapper = mount(AgentCard, { props: { agent: agent({ lastAction: 'sent route plan' }) } })
    expect(wrapper.text()).toContain('sent route plan')
  })

  it('exposes state via data-state for styling/testing', () => {
    const wrapper = mount(AgentCard, { props: { agent: agent({ state: 'proposing' }) } })
    expect(wrapper.find('[data-testid="agent-card"]').attributes('data-state')).toBe('proposing')
  })
})

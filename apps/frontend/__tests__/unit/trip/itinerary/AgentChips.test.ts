import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import AgentChips from '~/components/trip/itinerary/AgentChips.vue'

describe('AgentChips', () => {
  it('renders one chip per agent', () => {
    const wrapper = mount(AgentChips, { props: { agentNames: ['alice', 'bob', 'carlos'] } })
    const chips = wrapper.findAll('[data-testid="agent-chip"]')
    expect(chips).toHaveLength(3)
    expect(chips[0]?.text()).toBe('alice')
  })

  it('colors chips using the app-wide AGENT_COLOURS map, falling back to neutral for an unrecognised name', () => {
    const wrapper = mount(AgentChips, { props: { agentNames: ['bob', 'unknown-agent'] } })
    const chips = wrapper.findAll('[data-testid="agent-chip"]')
    expect(chips[0]?.attributes('style')).toContain('--amber')
    expect(chips[1]?.attributes('style')).toContain('--fg-0')
  })

  it('renders nothing when no agents are involved yet', () => {
    const wrapper = mount(AgentChips, { props: { agentNames: [] } })
    expect(wrapper.findAll('[data-testid="agent-chip"]')).toHaveLength(0)
  })
})

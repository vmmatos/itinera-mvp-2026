import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import AgentList from '~/components/trip/negotiate/AgentList.vue'
import type { AgentCardState } from '~/types/index'

function agents(): AgentCardState[] {
  return [
    { id: 'alice', color: 'green', role: 'traveller', state: 'idle', lastAction: null, proposalCount: 0 },
    { id: 'bob', color: 'amber', role: 'traveller', state: 'thinking', lastAction: null, proposalCount: 0 },
    { id: 'logistics', color: 'blue', role: 'service', state: 'proposing', lastAction: null, proposalCount: 1 },
  ]
}

describe('AgentList', () => {
  it('renders one AgentCard per agent', () => {
    const wrapper = mount(AgentList, { props: { agents: agents() } })
    expect(wrapper.findAll('[data-testid="agent-card"]')).toHaveLength(3)
  })

  it('shows the busy-count header as "N / total busy"', () => {
    const wrapper = mount(AgentList, { props: { agents: agents() } })
    expect(wrapper.find('[data-testid="agent-summary"]').text()).toBe('2 / 3 busy')
  })

  it('shows 0 busy when every agent is idle', () => {
    const wrapper = mount(AgentList, {
      props: { agents: agents().map((a) => ({ ...a, state: 'idle' as const })) },
    })
    expect(wrapper.find('[data-testid="agent-summary"]').text()).toBe('0 / 3 busy')
  })

  it('renders the mobile horizontal-scroll container with a sized card per agent', () => {
    const wrapper = mount(AgentList, { props: { agents: agents() } })
    expect(wrapper.find('.agent-list-cards').exists()).toBe(true)
    expect(wrapper.findAll('.agent-card-item')).toHaveLength(3)
  })
})

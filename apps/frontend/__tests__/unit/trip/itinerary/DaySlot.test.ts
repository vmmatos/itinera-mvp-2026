import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import DaySlot from '~/components/trip/itinerary/DaySlot.vue'
import type { SlotItemVM } from '~/utils/itineraryViewModel'

function slot(overrides: Partial<SlotItemVM> = {}): SlotItemVM {
  return { title: 'Guided visit to Mértola Castle', description: 'A medieval castle.', costPerPerson: 18, agentName: 'alice', transit: null, ...overrides }
}

describe('DaySlot', () => {
  it('renders title, description, cost tag and the proposing agent', () => {
    const wrapper = mount(DaySlot, { props: { slot: slot(), phase: 'morning', priceMode: 'pp', travellers: 2, currencySymbol: '€' } })
    expect(wrapper.text()).toContain('Guided visit to Mértola Castle')
    expect(wrapper.text()).toContain('€18')
    expect(wrapper.text()).toContain('alice')
  })

  it('renders a nested transit block when the slot carries transit data', () => {
    const wrapper = mount(DaySlot, {
      props: {
        slot: slot({ transit: { icon: '🚗', modeLabel: 'Drive', destination: 'Seia', durationLabel: '4h 55m', priceEurPerPerson: 107, alternatives: [] } }),
        phase: 'morning', priceMode: 'pp', travellers: 2, currencySymbol: '€',
      },
    })
    expect(wrapper.find('[data-testid="transit-block"]').exists()).toBe(true)
  })

  it('does not render a cost/agent tag row when neither is present', () => {
    const wrapper = mount(DaySlot, { props: { slot: slot({ costPerPerson: undefined, agentName: undefined }), phase: 'evening', priceMode: 'pp', travellers: 2, currencySymbol: '€' } })
    expect(wrapper.find('.tags').exists()).toBe(false)
  })
})

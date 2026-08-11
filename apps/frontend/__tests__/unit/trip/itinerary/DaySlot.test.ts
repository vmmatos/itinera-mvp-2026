import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import DaySlot from '~/components/trip/itinerary/DaySlot.vue'
import type { SlotItemVM } from '~/utils/itineraryViewModel'

function slot(overrides: Partial<SlotItemVM> = {}): SlotItemVM {
  return { title: 'Guided visit to Mértola Castle', description: 'A medieval castle.', costPerPerson: 18, agentName: 'alice', transit: null, gettingThere: null, ...overrides }
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
        slot: slot({ transit: { icon: '🚗', routeLabel: 'Drive →Seia', destination: 'Seia', durationLabel: '4h 55m', priceEurPerPerson: 107, qualifier: 'Recommended option', alternatives: [] } }),
        phase: 'morning', priceMode: 'pp', travellers: 2, currencySymbol: '€',
      },
    })
    expect(wrapper.find('[data-testid="transit-block"]').exists()).toBe(true)
  })

  it('does not render the generated title when the slot carries transit data', () => {
    const wrapper = mount(DaySlot, {
      props: {
        slot: slot({
          title: 'Drive →Porto — €13/person — 0h 44m',
          transit: { icon: '🚗', routeLabel: 'Drive →Porto', destination: 'Porto', durationLabel: '0h 44m', priceEurPerPerson: 13, qualifier: 'Recommended option', alternatives: [] },
        }),
        phase: 'morning', priceMode: 'pp', travellers: 2, currencySymbol: '€',
      },
    })
    expect(wrapper.find('h3').exists()).toBe(false)
  })

  it('still renders the title for a normal activity that has no transit data', () => {
    const wrapper = mount(DaySlot, { props: { slot: slot(), phase: 'morning', priceMode: 'pp', travellers: 2, currencySymbol: '€' } })
    expect(wrapper.find('h3').text()).toBe('Guided visit to Mértola Castle')
  })

  it('does not render a cost/agent tag row when neither is present', () => {
    const wrapper = mount(DaySlot, { props: { slot: slot({ costPerPerson: undefined, agentName: undefined }), phase: 'evening', priceMode: 'pp', travellers: 2, currencySymbol: '€' } })
    expect(wrapper.find('.tags').exists()).toBe(false)
  })

  it('renders a duration tag next to cost and the proposing agent when durationMinutes is present', () => {
    const wrapper = mount(DaySlot, { props: { slot: slot({ durationMinutes: 90 }), phase: 'morning', priceMode: 'pp', travellers: 2, currencySymbol: '€' } })
    expect(wrapper.text()).toContain('1h 30m')
  })

  it('renders the tag row for duration alone, with no cost and no agent', () => {
    const wrapper = mount(DaySlot, {
      props: { slot: slot({ costPerPerson: undefined, agentName: undefined, durationMinutes: 45 }), phase: 'evening', priceMode: 'pp', travellers: 2, currencySymbol: '€' },
    })
    expect(wrapper.find('.tags').exists()).toBe(true)
    expect(wrapper.text()).toContain('0h 45m')
  })

  it('does not render a duration tag when durationMinutes is absent', () => {
    const wrapper = mount(DaySlot, { props: { slot: slot({ durationMinutes: undefined }), phase: 'morning', priceMode: 'pp', travellers: 2, currencySymbol: '€' } })
    expect(wrapper.find('.tag.duration').exists()).toBe(false)
  })

  it('renders the green address line when location and country are present', () => {
    const wrapper = mount(DaySlot, {
      props: { slot: slot({ location: 'Cais da Ribeira & Ponte Dom Luís I', country: 'Portugal' }), phase: 'afternoon', priceMode: 'pp', travellers: 2, currencySymbol: '€' },
    })
    expect(wrapper.find('.slot-city').text()).toBe('Cais da Ribeira & Ponte Dom Luís I, Portugal')
  })

  it('renders the address line with location only when country is absent', () => {
    const wrapper = mount(DaySlot, {
      props: { slot: slot({ location: 'Graham\'s Port Lodge', country: undefined }), phase: 'evening', priceMode: 'pp', travellers: 2, currencySymbol: '€' },
    })
    expect(wrapper.find('.slot-city').text()).toBe('Graham\'s Port Lodge')
  })

  it('does not render an address line when neither location nor country is present', () => {
    const wrapper = mount(DaySlot, {
      props: { slot: slot({ location: undefined, country: undefined }), phase: 'morning', priceMode: 'pp', travellers: 2, currencySymbol: '€' },
    })
    expect(wrapper.find('.slot-city').exists()).toBe(false)
  })

  it('renders a getting-there line when the slot carries gettingThere data', () => {
    const wrapper = mount(DaySlot, {
      props: {
        slot: slot({ gettingThere: { icon: '🚗', modeKey: 'drive', durationLabel: '0h 12m', priceEurPerPerson: undefined } }),
        phase: 'evening', priceMode: 'pp', travellers: 2, currencySymbol: '€',
      },
    })
    expect(wrapper.find('.getting-there').exists()).toBe(true)
    expect(wrapper.find('.getting-there').text()).toContain('0h 12m')
  })

  it('does not render a getting-there line when absent', () => {
    const wrapper = mount(DaySlot, { props: { slot: slot(), phase: 'morning', priceMode: 'pp', travellers: 2, currencySymbol: '€' } })
    expect(wrapper.find('.getting-there').exists()).toBe(false)
  })
})

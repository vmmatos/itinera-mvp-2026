import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import TransitBlock from '~/components/trip/itinerary/TransitBlock.vue'
import type { TransitVM } from '~/utils/itineraryV2'

function transit(overrides: Partial<TransitVM> = {}): TransitVM {
  return {
    icon: '🚗',
    modeLabel: 'Drive',
    destination: 'Seia',
    durationLabel: '4h 55m',
    priceEurPerPerson: 107,
    warning: 'Long journey',
    alternatives: [
      { icon: '✈️', label: 'Fly', durationLabel: '3h 40m', priceEurPerPerson: 189 },
      { icon: '🚆', label: 'Train', durationLabel: '6h 20m', priceEurPerPerson: 96 },
      { icon: '🚐', label: 'Drive', durationLabel: '4h 30m', priceEurPerPerson: 240 },
    ],
    ...overrides,
  }
}

describe('TransitBlock', () => {
  it('renders mode, price (in €, per person) and duration', () => {
    const wrapper = mount(TransitBlock, { props: { transit: transit(), priceMode: 'pp', travellers: 2 } })
    expect(wrapper.find('[data-testid="transit-price"]').text()).toBe('€107')
    expect(wrapper.text()).toContain('4h 55m')
  })

  it('always prices in € regardless of priceMode/travellers scaling the amount, not the currency', () => {
    const wrapper = mount(TransitBlock, { props: { transit: transit(), priceMode: 'total', travellers: 2 } })
    expect(wrapper.find('[data-testid="transit-price"]').text()).toBe('€214')
  })

  it('starts with the alternatives list collapsed', () => {
    const wrapper = mount(TransitBlock, { props: { transit: transit(), priceMode: 'pp', travellers: 2 } })
    expect(wrapper.findAll('[data-testid="transit-alt"]')).toHaveLength(0)
  })

  it('clicking "N other options" expands the alt list, clicking again collapses it', async () => {
    const wrapper = mount(TransitBlock, { props: { transit: transit(), priceMode: 'pp', travellers: 2 } })
    const toggle = wrapper.find('[data-testid="transit-alts-toggle"]')
    expect(toggle.text()).toContain('3 other options')

    await toggle.trigger('click')
    expect(wrapper.findAll('[data-testid="transit-alt"]')).toHaveLength(3)

    await toggle.trigger('click')
    expect(wrapper.findAll('[data-testid="transit-alt"]')).toHaveLength(0)
  })

  it('renders a real warning verbatim', () => {
    const wrapper = mount(TransitBlock, { props: { transit: transit({ warning: 'Overnight layover required' }), priceMode: 'pp', travellers: 2 } })
    expect(wrapper.text()).toContain('Overnight layover required')
  })

  it('does not render an alternatives toggle when there are none', () => {
    const wrapper = mount(TransitBlock, { props: { transit: transit({ alternatives: [] }), priceMode: 'pp', travellers: 2 } })
    expect(wrapper.find('[data-testid="transit-alts-toggle"]').exists()).toBe(false)
  })
})

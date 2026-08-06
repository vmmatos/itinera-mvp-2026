import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import TransitBlock from '~/components/trip/itinerary/TransitBlock.vue'
import type { TransitVM } from '~/utils/itineraryViewModel'

function transit(overrides: Partial<TransitVM> = {}): TransitVM {
  return {
    icon: '🚗',
    routeLabel: 'Drive →Seia',
    destination: 'Seia',
    durationLabel: '4h 55m',
    priceEurPerPerson: 107,
    qualifier: 'Recommended option',
    warning: 'Long journey',
    alternatives: [
      { icon: '✈️', routeLabel: 'Fly →Seia', durationLabel: '3h 40m', priceEurPerPerson: 189, priceDeltaLabel: '+€82' },
      { icon: '🚆', routeLabel: 'Train →Seia', durationLabel: '6h 20m', priceEurPerPerson: 96, departureTime: '12:00' },
      { icon: '🚐', routeLabel: 'Drive →Seia', durationLabel: '4h 30m', priceEurPerPerson: 240 },
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

  it('always renders the qualifier caption', () => {
    const wrapper = mount(TransitBlock, {
      props: { transit: transit({ qualifier: 'Cheapest option — €13 vs €23 alternative' }), priceMode: 'pp', travellers: 2 },
    })
    expect(wrapper.find('[data-testid="transit-qualifier"]').text()).toBe('Cheapest option — €13 vs €23 alternative')
  })

  it('shows an alternative\'s departure time and price delta when present', async () => {
    const wrapper = mount(TransitBlock, { props: { transit: transit(), priceMode: 'pp', travellers: 2 } })
    await wrapper.find('[data-testid="transit-alts-toggle"]').trigger('click')

    const alts = wrapper.findAll('[data-testid="transit-alt"]')
    expect(alts[0]!.text()).toContain('+€82')
    expect(alts[1]!.text()).toContain('12:00')
  })
})

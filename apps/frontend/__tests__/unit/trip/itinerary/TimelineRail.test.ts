import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import TimelineRail from '~/components/trip/itinerary/TimelineRail.vue'
import type { DayVM, SegmentVM } from '~/utils/itineraryViewModel'

function dayVM(index: number, overrides: Partial<DayVM> = {}): DayVM {
  return {
    day: index + 1, index, dateLabel: `D${index + 1}`, city: 'Mértola', costPerPerson: 100, isTransitDay: false,
    weather: null, slots: { morning: [], afternoon: [], evening: [] }, ...overrides,
  }
}

const oneSegment: SegmentVM[] = [{ city: 'Mértola', dayIndexes: [0, 1] }]
const twoSegments: SegmentVM[] = [
  { city: 'Mértola', dayIndexes: [0, 1], transitAfter: { icon: '⇢', label: '4h 55m' } },
  { city: 'Seia', dayIndexes: [2] },
]

describe('TimelineRail', () => {
  it('renders one day cell per day', () => {
    const wrapper = mount(TimelineRail, {
      props: { segments: oneSegment, days: [dayVM(0), dayVM(1)], selectedDay: 0, priceMode: 'pp', travellers: 2, currencySymbol: '€', showWeather: true },
    })
    expect(wrapper.findAll('[data-testid="day-cell"]')).toHaveLength(2)
  })

  it('single-city trip renders no transit node', () => {
    const wrapper = mount(TimelineRail, {
      props: { segments: oneSegment, days: [dayVM(0), dayVM(1)], selectedDay: 0, priceMode: 'pp', travellers: 2, currencySymbol: '€', showWeather: true },
    })
    expect(wrapper.find('.transit-gap').exists()).toBe(false)
  })

  it('multi-city trip renders a transit node between segments', () => {
    const wrapper = mount(TimelineRail, {
      props: { segments: twoSegments, days: [dayVM(0), dayVM(1), dayVM(2)], selectedDay: 0, priceMode: 'pp', travellers: 2, currencySymbol: '€', showWeather: true },
    })
    expect(wrapper.find('.transit-gap').text()).toContain('4h 55m')
  })

  it('clicking a day cell emits select with its index', async () => {
    const wrapper = mount(TimelineRail, {
      props: { segments: oneSegment, days: [dayVM(0), dayVM(1)], selectedDay: 0, priceMode: 'pp', travellers: 2, currencySymbol: '€', showWeather: true },
    })
    await wrapper.findAll('[data-testid="day-cell"]')[1]!.trigger('click')
    expect(wrapper.emitted('select')?.[0]).toEqual([1])
  })

  it('shows the heat flag only on a heat-risk day', () => {
    const wrapper = mount(TimelineRail, {
      props: {
        segments: oneSegment,
        days: [dayVM(0, { weather: { icon: '☀️', risk: 'heat', tempHigh: 38 } }), dayVM(1, { weather: { icon: '⛅', risk: 'low', tempHigh: 25 } })],
        selectedDay: 0, priceMode: 'pp', travellers: 2, currencySymbol: '€', showWeather: true,
      },
    })
    const cells = wrapper.findAll('[data-testid="day-cell"]')
    expect(cells[0]?.find('[data-testid="heat-flag"]').exists()).toBe(true)
    expect(cells[1]?.find('[data-testid="heat-flag"]').exists()).toBe(false)
  })

  // Was: "labels the rail as having no live forecast". A trip with no live
  // forecast now shows no weather UI at all rather than a placeholder label.
  it('renders no weather chip at all when showWeather is false', () => {
    const wrapper = mount(TimelineRail, {
      props: { segments: oneSegment, days: [dayVM(0)], selectedDay: 0, priceMode: 'pp', travellers: 2, currencySymbol: '€', showWeather: false },
    })
    expect(wrapper.find('[data-testid="rail-weather-chip"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('weather')
  })

  it('renders the live-forecast chip when showWeather is true', () => {
    const wrapper = mount(TimelineRail, {
      props: { segments: oneSegment, days: [dayVM(0)], selectedDay: 0, priceMode: 'pp', travellers: 2, currencySymbol: '€', showWeather: true },
    })
    expect(wrapper.find('[data-testid="rail-weather-chip"]').text()).toContain('live forecast')
  })
})

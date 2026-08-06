import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import DayPanel from '~/components/trip/itinerary/DayPanel.vue'
import type { DayVM } from '~/utils/itineraryViewModel'
import type { RestrictionWarning } from '~/utils/itinerary'

function dayVM(overrides: Partial<DayVM> = {}): DayVM {
  return {
    day: 1,
    index: 0,
    dateLabel: 'Sat 12 Jul',
    city: 'Mértola, Portugal',
    costPerPerson: 142,
    isTransitDay: false,
    weather: null,
    slots: {
      morning: [{ title: 'Castle visit', costPerPerson: 18, agentName: 'alice', transit: null }],
      afternoon: [],
      evening: [],
    },
    ...overrides,
  }
}

describe('DayPanel', () => {
  it('renders the city title and the day’s slots', () => {
    const wrapper = mount(DayPanel, { props: { day: dayVM(), dayIndex: 0, totalDays: 8, priceMode: 'pp', travellers: 2, currencySymbol: '€' } })
    expect(wrapper.find('[data-testid="day-city"]').text()).toBe('Mértola, Portugal')
    expect(wrapper.findAll('[data-testid="day-slot"]')).toHaveLength(1)
  })

  it('disables the prev arrow on day 1 and the next arrow on the last day', () => {
    const first = mount(DayPanel, { props: { day: dayVM(), dayIndex: 0, totalDays: 8, priceMode: 'pp', travellers: 2, currencySymbol: '€' } })
    expect(first.find('[data-testid="day-prev"]').attributes('disabled')).toBeDefined()
    expect(first.find('[data-testid="day-next"]').attributes('disabled')).toBeUndefined()

    const last = mount(DayPanel, { props: { day: dayVM({ index: 7 }), dayIndex: 7, totalDays: 8, priceMode: 'pp', travellers: 2, currencySymbol: '€' } })
    expect(last.find('[data-testid="day-next"]').attributes('disabled')).toBeDefined()
  })

  it('clicking the arrows emits prev/next', async () => {
    const wrapper = mount(DayPanel, { props: { day: dayVM({ index: 1 }), dayIndex: 1, totalDays: 8, priceMode: 'pp', travellers: 2, currencySymbol: '€' } })
    await wrapper.find('[data-testid="day-prev"]').trigger('click')
    await wrapper.find('[data-testid="day-next"]').trigger('click')
    expect(wrapper.emitted('prev')).toHaveLength(1)
    expect(wrapper.emitted('next')).toHaveLength(1)
  })

  it('shows the heat advisory strip and risk chip on a heat-risk day', () => {
    const wrapper = mount(DayPanel, {
      props: {
        day: dayVM({ weather: { icon: '☀️', condition: 'Clear', tempHigh: 38, tempLow: 21, precipitationProbability: 0, risk: 'heat' } }),
        dayIndex: 0, totalDays: 8, priceMode: 'pp', travellers: 2, currencySymbol: '€',
      },
    })
    expect(wrapper.find('[data-testid="heat-advisory"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="risk-chip"]').text()).toContain('heat advisory')
  })

  it('does not show a risk chip for an unknown-risk (no forecast) day, and does not crash', () => {
    const wrapper = mount(DayPanel, {
      props: {
        day: dayVM({ weather: { icon: '🌡️', risk: 'unknown' } }),
        dayIndex: 0, totalDays: 8, priceMode: 'pp', travellers: 2, currencySymbol: '€',
      },
    })
    expect(wrapper.find('[data-testid="risk-chip"]').exists()).toBe(false)
  })

  it('renders no weather banner at all when weather is null (older proposal / merge race)', () => {
    const wrapper = mount(DayPanel, { props: { day: dayVM({ weather: null }), dayIndex: 0, totalDays: 8, priceMode: 'pp', travellers: 2, currencySymbol: '€' } })
    expect(wrapper.find('[data-testid="weather-banner"]').exists()).toBe(false)
  })

  it('shows an empty state when a day has no activities in any slot', () => {
    const wrapper = mount(DayPanel, {
      props: { day: dayVM({ slots: { morning: [], afternoon: [], evening: [] } }), dayIndex: 0, totalDays: 8, priceMode: 'pp', travellers: 2, currencySymbol: '€' },
    })
    expect(wrapper.find('[data-testid="day-empty"]').exists()).toBe(true)
  })

  it('shows the restriction-warning banner for a day with matching warnings', () => {
    const warnings: RestrictionWarning[] = [
      { day: 1, activityName: 'Pilgrimage climb', warningType: 'opening_hours', message: '⚠ "Pilgrimage climb and panoramic visit to Bom Jesus do Monte" opens 8:00 AM-7:00 PM but activity is scheduled at 09:00 on Friday. Check current hours before visiting.' },
    ]
    const wrapper = mount(DayPanel, {
      props: { day: dayVM({ day: 1 }), dayIndex: 0, totalDays: 8, priceMode: 'pp', travellers: 2, currencySymbol: '€', restrictionWarnings: warnings },
    })
    expect(wrapper.find('[data-testid="restriction-warnings"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('Check current hours before visiting.')
  })

  it('does not show the restriction-warning banner when warnings belong to a different day', () => {
    const warnings: RestrictionWarning[] = [
      { day: 2, activityName: 'Pilgrimage climb', warningType: 'opening_hours', message: '⚠ some other day warning' },
    ]
    const wrapper = mount(DayPanel, {
      props: { day: dayVM({ day: 1 }), dayIndex: 0, totalDays: 8, priceMode: 'pp', travellers: 2, currencySymbol: '€', restrictionWarnings: warnings },
    })
    expect(wrapper.find('[data-testid="restriction-warnings"]').exists()).toBe(false)
  })

  it('stacks multiple warnings for the same day', () => {
    const warnings: RestrictionWarning[] = [
      { day: 1, activityName: 'A', warningType: 'holiday', message: '⚠ first warning' },
      { day: 1, activityName: 'B', warningType: 'opening_hours', message: '⚠ second warning' },
    ]
    const wrapper = mount(DayPanel, {
      props: { day: dayVM({ day: 1 }), dayIndex: 0, totalDays: 8, priceMode: 'pp', travellers: 2, currencySymbol: '€', restrictionWarnings: warnings },
    })
    const items = wrapper.findAll('.dp-restriction-item')
    expect(items).toHaveLength(2)
  })

  it('does not show the restriction-warning banner when no warnings are passed', () => {
    const wrapper = mount(DayPanel, {
      props: { day: dayVM({ day: 1 }), dayIndex: 0, totalDays: 8, priceMode: 'pp', travellers: 2, currencySymbol: '€' },
    })
    expect(wrapper.find('[data-testid="restriction-warnings"]').exists()).toBe(false)
  })
})

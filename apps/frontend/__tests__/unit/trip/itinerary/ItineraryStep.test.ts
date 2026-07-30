import { describe, it, expect, afterEach } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import ItineraryStep from '~/components/trip/itinerary/ItineraryStep.vue'
import type { ItineraryDay, BudgetBreakdown, TransportOption } from '~/types/index'

const TRANSPORT_OPTION: TransportOption = { mode: 'car', durationMinutes: 295, priceEur: 107, warnings: [] }

function twoDayItinerary(): ItineraryDay[] {
  return [
    { day: 1, date: 'Sat 12 Jul', city: 'Mértola', activities: [{ name: 'Castle visit', time: 'morning', cost: 18, ownerAgent: 'alice' }] },
    {
      day: 2, date: 'Sun 13 Jul', city: 'Seia',
      cityTransition: { to: 'Seia', travelTime: '4h 55m' },
      activities: [{ name: 'In transit', time: 'morning', transportData: { to: 'Seia', selectedOption: TRANSPORT_OPTION, alternatives: [] } }],
    },
  ]
}

function budgetBreakdown(): BudgetBreakdown {
  return {
    currency: 'EUR', currencyMismatch: false, groupSize: 2,
    categories: {
      accommodation: { amountPerPerson: 286, amountTotal: 572, isEstimate: false, source: 'x' },
      restaurants: { amountPerPerson: 142, amountTotal: 284, isEstimate: false, source: 'x' },
      activities: { amountPerPerson: 223, amountTotal: 446, isEstimate: false, source: 'x' },
      transport: { amountPerPerson: 189, amountTotal: 378, isEstimate: false, source: 'x' },
      buffer: { amountPerPerson: 84, amountTotal: 168, isEstimate: false, source: 'x' },
    },
    perPersonTotal: 924, grandTotal: 1848, budgetTotal: 2100, status: 'within_budget', percentageUsed: 44,
    overruns: [], suggestedCuts: [],
  }
}

function baseProps(overrides: Record<string, unknown> = {}) {
  return {
    tripName: 'Alentejo → Serra da Estrela', region: 'Alentejo', startDate: '2026-07-12', endDate: '2026-07-19',
    dateMode: 'fixed' as const, preferredMonth: '', travellers: 2,
    timelineDays: twoDayItinerary(), budgetBreakdown: budgetBreakdown(), accommodation: [],
    weatherAssessment: null, showWeather: true, validatorSummary: { fairnessScore: 100, overallScore: 92, constraintsPassed: true, rounds: 2 },
    travellerScores: [], agentNames: ['alice', 'logistics'],
    exportLoading: false, shareLoading: false, shareCopied: false, exportError: null, shareError: null,
    ...overrides,
  }
}

let wrapper: VueWrapper | null = null
afterEach(() => {
  wrapper?.unmount()
  wrapper = null
})

describe('ItineraryStep', () => {
  it('renders a graceful empty state for an empty itinerary, not a crash', () => {
    wrapper = mount(ItineraryStep, { props: baseProps({ timelineDays: [] }) })
    expect(wrapper.find('[data-testid="itinerary-empty"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="day-cell"]').exists()).toBe(false)
  })

  it('a single-day trip renders one rail cell and no transit node', () => {
    wrapper = mount(ItineraryStep, { props: baseProps({ timelineDays: [twoDayItinerary()[0]!] }) })
    expect(wrapper.findAll('[data-testid="day-cell"]')).toHaveLength(1)
    expect(wrapper.find('.transit-gap').exists()).toBe(false)
  })

  it('defaults to focusing day 1', () => {
    wrapper = mount(ItineraryStep, { props: baseProps() })
    expect(wrapper.find('[data-testid="day-city"]').text()).toBe('Mértola')
  })

  it('clicking a rail cell updates the focused day panel', async () => {
    wrapper = mount(ItineraryStep, { props: baseProps() })
    await wrapper.findAll('[data-testid="day-cell"]')[1]!.trigger('click')
    expect(wrapper.find('[data-testid="day-city"]').text()).toBe('Seia')
  })

  it('clicking a cost-by-day bar updates the focused day panel', async () => {
    wrapper = mount(ItineraryStep, { props: baseProps() })
    await wrapper.findAll('[data-testid="cost-bar"]')[1]!.trigger('click')
    expect(wrapper.find('[data-testid="day-city"]').text()).toBe('Seia')
  })

  it('ArrowRight/ArrowLeft navigate days and clamp at the bounds', async () => {
    wrapper = mount(ItineraryStep, { props: baseProps(), attachTo: document.body })
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }))
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-testid="day-city"]').text()).toBe('Mértola') // clamped at day 0

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }))
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-testid="day-city"]').text()).toBe('Seia')

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }))
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-testid="day-city"]').text()).toBe('Seia') // clamped at last day
  })

  it('toggling pp/total recomputes the rail cost, price hero, category amounts and the transit price pill together', async () => {
    wrapper = mount(ItineraryStep, { props: baseProps() })
    expect(wrapper.find('[data-testid="cost-hero"]').text()).toBe('€924')

    await wrapper.find('[data-testid="price-toggle"]').findAll('button')[1]!.trigger('click')

    expect(wrapper.find('[data-testid="cost-hero"]').text()).toBe('€1,848')
    const categoryAmounts = wrapper.findAll('[data-testid="category-row"] .amt')
    expect(categoryAmounts[0]?.text()).toContain('572') // accommodation total
    await wrapper.findAll('[data-testid="day-cell"]')[1]!.trigger('click')
    expect(wrapper.find('[data-testid="transit-price"]').text()).toBe('€214') // 107 * 2 travellers
  })

  it('does not crash and still renders slots when weatherAssessment is entirely null', () => {
    wrapper = mount(ItineraryStep, { props: baseProps({ weatherAssessment: null }) })
    expect(wrapper.find('[data-testid="weather-banner"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="day-slot"]').exists()).toBe(true)
  })
})

describe('ItineraryStep — per-traveller preference match', () => {
  const SCORES = [
    { travellerId: 't1', label: 'Ana', score: 100 },
    { travellerId: 't2', label: 'Bruno', score: 50 },
  ]

  it('forwards the traveller rows into the summary panel', () => {
    wrapper = mount(ItineraryStep, { props: baseProps({ travellerScores: SCORES }) })

    const rows = wrapper.findAll('[data-testid="traveller-satisfaction-row"]')
    expect(rows).toHaveLength(2)
    expect(rows[0]!.text()).toContain('Ana')
  })

  it('keeps showing the group aggregate when there are no traveller rows', () => {
    wrapper = mount(ItineraryStep, { props: baseProps({ travellerScores: [] }) })

    expect(wrapper.find('[data-testid="traveller-satisfaction"]').exists()).toBe(false)
    // validatorSummary.overallScore is 92 in baseProps.
    expect(wrapper.text()).toContain('92%')
  })

  it('falls back to the mean of the rows when the validator sent no overall score', () => {
    wrapper = mount(ItineraryStep, {
      props: baseProps({
        travellerScores: SCORES,
        validatorSummary: { fairnessScore: 100, overallScore: null, constraintsPassed: true, rounds: 2 },
      }),
    })

    expect(wrapper.text()).toContain('75%')
  })
})

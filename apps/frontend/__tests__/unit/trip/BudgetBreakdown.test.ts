import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import BudgetBreakdown from '~/components/trip/BudgetBreakdown.vue'
import type { BudgetBreakdown as BudgetBreakdownType, BudgetCategoryDetail } from '~/types/index'

function categoryDetail(overrides: Partial<BudgetCategoryDetail> = {}): BudgetCategoryDetail {
  return { amountPerPerson: 50, amountTotal: 100, isEstimate: false, source: 'attraction_db', ...overrides }
}

function makeBreakdown(overrides: Partial<BudgetBreakdownType> = {}): BudgetBreakdownType {
  return {
    currency: 'EUR',
    currencyMismatch: false,
    groupSize: 2,
    categories: {
      accommodation: categoryDetail({ amountPerPerson: 120, amountTotal: 240, source: 'serpapi_google_hotels' }),
      restaurants: categoryDetail({ amountPerPerson: 50, amountTotal: 100, source: 'google_places_price_level' }),
      activities: categoryDetail({ amountPerPerson: 20, amountTotal: 40, source: 'attraction_db' }),
      transport: categoryDetail({ amountPerPerson: 80, amountTotal: 160, source: 'serpapi_google_flights', isEstimate: false }),
      buffer: categoryDetail({ amountPerPerson: 27, amountTotal: 54, source: 'heuristic_estimate' }),
    },
    perPersonTotal: 297,
    grandTotal: 594,
    budgetTotal: 600,
    status: 'within_budget',
    percentageUsed: 99,
    overruns: [],
    suggestedCuts: [],
    ...overrides,
  }
}

describe('BudgetBreakdown', () => {
  // ── Happy path ───────────────────────────────────────────────

  it('renders every category row with per-person and total amounts', () => {
    const wrapper = mount(BudgetBreakdown, { props: { breakdown: makeBreakdown() } })
    const text = wrapper.text()

    expect(text).toContain('Accommodation')
    expect(text).toContain('€120/person')
    expect(text).toContain('€240 total')
    expect(text).toContain('Restaurants')
    expect(text).toContain('Activities')
    expect(text).toContain('Transport')
    expect(text).toContain('Buffer (10%)')
  })

  it('shows a within-budget pill when status is within_budget', () => {
    const wrapper = mount(BudgetBreakdown, { props: { breakdown: makeBreakdown() } })
    expect(wrapper.text()).toContain('Within budget')
    expect(wrapper.text()).not.toContain('Over budget')
  })

  it('shows the grand total and percentage used', () => {
    const wrapper = mount(BudgetBreakdown, { props: { breakdown: makeBreakdown() } })
    expect(wrapper.text()).toContain('€594 total')
    expect(wrapper.text()).toContain('99% of €600 budget')
    expect(wrapper.text()).toContain('2 traveller(s)')
  })

  it('does not render overruns or suggested cuts sections when both are empty', () => {
    const wrapper = mount(BudgetBreakdown, { props: { breakdown: makeBreakdown() } })
    expect(wrapper.text()).not.toContain('Over budget by category')
    expect(wrapper.text()).not.toContain('Suggested cuts')
  })

  // ── Error / edge cases ───────────────────────────────────────

  it('shows an over-budget pill and overrun detail when status is over_budget', () => {
    const wrapper = mount(BudgetBreakdown, {
      props: {
        breakdown: makeBreakdown({
          status: 'over_budget',
          overruns: [{ category: 'accommodation', overAmountPerPerson: 45, overAmountTotal: 90 }],
        }),
      },
    })

    expect(wrapper.text()).toContain('Over budget')
    expect(wrapper.text()).toContain('Over budget by category')
    expect(wrapper.text()).toContain('+€90')
  })

  it('shows suggested cuts with descriptions and savings', () => {
    const wrapper = mount(BudgetBreakdown, {
      props: {
        breakdown: makeBreakdown({
          suggestedCuts: [
            { category: 'accommodation', description: 'Switch to Hostel X', savingPerPerson: 45, savingTotal: 90 },
          ],
        }),
      },
    })

    expect(wrapper.text()).toContain('Switch to Hostel X')
    expect(wrapper.text()).toContain('saves €45/person')
    expect(wrapper.text()).toContain('€90 total')
  })

  it('shows a warning icon for categories flagged as estimates', () => {
    const wrapper = mount(BudgetBreakdown, {
      props: {
        breakdown: makeBreakdown({
          categories: {
            ...makeBreakdown().categories,
            accommodation: categoryDetail({ isEstimate: true, source: 'heuristic_estimate' }),
          },
        }),
      },
    })

    const warningIcons = wrapper.findAll('[title="Real price unavailable — estimate shown"]')
    expect(warningIcons.length).toBe(1)
  })

  it('shows a currency mismatch banner when currencyMismatch is true', () => {
    const wrapper = mount(BudgetBreakdown, {
      props: { breakdown: makeBreakdown({ currencyMismatch: true, currency: 'USD' }) },
    })

    expect(wrapper.text()).toContain('USD')
    expect(wrapper.text()).toContain('computed in EUR')
  })

  it('renders zero-amount categories without throwing', () => {
    const zeroed = categoryDetail({ amountPerPerson: 0, amountTotal: 0 })
    const wrapper = mount(BudgetBreakdown, {
      props: {
        breakdown: makeBreakdown({
          categories: {
            accommodation: zeroed,
            restaurants: zeroed,
            activities: zeroed,
            transport: zeroed,
            buffer: zeroed,
          },
          grandTotal: 0,
          perPersonTotal: 0,
        }),
      },
    })

    expect(wrapper.text()).toContain('€0 total')
  })
})

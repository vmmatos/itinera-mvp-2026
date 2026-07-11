import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import PriceSummary from '~/components/trip/itinerary/PriceSummary.vue'
import type { BudgetBreakdown } from '~/types/index'

function breakdown(overrides: Partial<BudgetBreakdown> = {}): BudgetBreakdown {
  return {
    currency: 'EUR',
    currencyMismatch: false,
    groupSize: 2,
    categories: {
      accommodation: { amountPerPerson: 286, amountTotal: 572, isEstimate: false, source: 'x' },
      restaurants: { amountPerPerson: 142, amountTotal: 284, isEstimate: false, source: 'x' },
      activities: { amountPerPerson: 223, amountTotal: 446, isEstimate: false, source: 'x' },
      transport: { amountPerPerson: 189, amountTotal: 378, isEstimate: false, source: 'x' },
      buffer: { amountPerPerson: 84, amountTotal: 168, isEstimate: false, source: 'x' },
    },
    perPersonTotal: 924,
    grandTotal: 1848,
    budgetTotal: 2100,
    status: 'within_budget',
    percentageUsed: 44,
    overruns: [],
    suggestedCuts: [],
    ...overrides,
  }
}

describe('PriceSummary', () => {
  it('shows the within-budget badge and 5 category rows', () => {
    const wrapper = mount(PriceSummary, { props: { budgetBreakdown: breakdown(), priceMode: 'pp', travellers: 2, currencySymbol: '€' } })
    expect(wrapper.find('[data-testid="budget-badge"]').text()).toContain('within budget')
    expect(wrapper.findAll('[data-testid="category-row"]')).toHaveLength(5)
    expect(wrapper.find('[data-testid="cost-hero"]').text()).toBe('€924')
  })

  it('shows the over-budget badge when status is over_budget', () => {
    const wrapper = mount(PriceSummary, { props: { budgetBreakdown: breakdown({ status: 'over_budget' }), priceMode: 'pp', travellers: 2, currencySymbol: '€' } })
    expect(wrapper.find('[data-testid="budget-badge"]').text()).toContain('over budget')
  })

  it('recomputes the hero total when switching to total mode', () => {
    const wrapper = mount(PriceSummary, { props: { budgetBreakdown: breakdown(), priceMode: 'total', travellers: 2, currencySymbol: '€' } })
    expect(wrapper.find('[data-testid="cost-hero"]').text()).toBe('€1,848')
  })

  it('shows the currency-mismatch warning with the exact wording BudgetBreakdown.vue uses', () => {
    const wrapper = mount(PriceSummary, {
      props: { budgetBreakdown: breakdown({ currency: 'USD', currencyMismatch: true }), priceMode: 'pp', travellers: 2, currencySymbol: '$' },
    })
    expect(wrapper.text()).toContain('Trip budget is in USD; real prices below are computed in EUR.')
  })

  it('renders an empty state instead of crashing when budgetBreakdown is null', () => {
    const wrapper = mount(PriceSummary, { props: { budgetBreakdown: null, priceMode: 'pp', travellers: 2, currencySymbol: '€' } })
    expect(wrapper.find('[data-testid="cost-hero"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('not available yet')
  })
})

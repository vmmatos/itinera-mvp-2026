import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import TravellerSatisfaction from '~/components/trip/itinerary/TravellerSatisfaction.vue'
import type { TravellerScore } from '~/types/index'

const rows = (scores: TravellerScore[]) =>
  mount(TravellerSatisfaction, { props: { scores } })

describe('TravellerSatisfaction', () => {
  it('renders one row per traveller with its label and rounded score', () => {
    const wrapper = rows([
      { travellerId: 't1', label: 'Ana', score: 100 },
      { travellerId: 't2', label: 'Gastronomy', score: 66.6 },
    ])

    const items = wrapper.findAll('[data-testid="traveller-satisfaction-row"]')
    expect(items).toHaveLength(2)
    expect(items[0].text()).toContain('Ana')
    expect(items[0].text()).toContain('100%')
    expect(items[1].text()).toContain('Gastronomy')
    expect(items[1].text()).toContain('67%')
  })

  it('shows the avoided terms that vetoed a traveller', () => {
    const wrapper = rows([{ travellerId: 't1', label: 'Ana', score: 0, vetoedBy: ['discotecas', 'casinos'] }])

    const chips = wrapper.findAll('[data-testid="veto-chip"]')
    expect(chips.map((c) => c.text())).toEqual(['discotecas', 'casinos'])
    expect(wrapper.text()).toContain('0%')
  })

  it('renders no veto chips for a traveller that was not vetoed', () => {
    const wrapper = rows([{ travellerId: 't1', label: 'Ana', score: 80 }])
    expect(wrapper.find('[data-testid="veto-chip"]').exists()).toBe(false)
  })

  it('renders nothing at all for an empty list (older trips carry no rows)', () => {
    const wrapper = rows([])
    expect(wrapper.find('[data-testid="traveller-satisfaction"]').exists()).toBe(false)
  })

  it('clamps out-of-range scores to the 0–100 bar', () => {
    const wrapper = rows([
      { travellerId: 't1', label: 'Over', score: 140 },
      { travellerId: 't2', label: 'Under', score: -20 },
    ])

    const bars = wrapper.findAll('.qbar .f')
    expect(bars[0].attributes('style')).toContain('width: 100%')
    expect(bars[1].attributes('style')).toContain('width: 0%')
  })

  it('still renders a row whose label is empty', () => {
    const wrapper = rows([{ travellerId: 't1', label: '', score: 50 }])
    expect(wrapper.findAll('[data-testid="traveller-satisfaction-row"]')).toHaveLength(1)
  })
})

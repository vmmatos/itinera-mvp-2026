import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import CostByDayChart from '~/components/trip/itinerary/CostByDayChart.vue'
import type { DayVM } from '~/utils/itineraryViewModel'

function dayVM(index: number, costPerPerson: number): DayVM {
  return { day: index + 1, index, dateLabel: `Day ${index + 1}`, city: 'Mértola', costPerPerson, isTransitDay: false, weather: null, slots: { morning: [], afternoon: [], evening: [] } }
}

describe('CostByDayChart', () => {
  it('renders one bar per day', () => {
    const wrapper = mount(CostByDayChart, { props: { days: [dayVM(0, 100), dayVM(1, 50)], selectedDay: 0 } })
    expect(wrapper.findAll('[data-testid="cost-bar"]')).toHaveLength(2)
  })

  it('clicking a bar emits select with the right index', async () => {
    const wrapper = mount(CostByDayChart, { props: { days: [dayVM(0, 100), dayVM(1, 50)], selectedDay: 0 } })
    await wrapper.findAll('[data-testid="cost-bar"]')[1]!.trigger('click')
    expect(wrapper.emitted('select')?.[0]).toEqual([1])
  })

  it('renders without crashing for an empty itinerary', () => {
    const wrapper = mount(CostByDayChart, { props: { days: [], selectedDay: 0 } })
    expect(wrapper.findAll('[data-testid="cost-bar"]')).toHaveLength(0)
  })
})

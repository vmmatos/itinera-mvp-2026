import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import DraftItinerary from '~/components/trip/negotiate/DraftItinerary.vue'
import type { DraftDay } from '~/types/index'

function emptyDay(day: number, city: string, date: string): DraftDay {
  return {
    day, date, city,
    slots: {
      morning: { status: 'empty' },
      afternoon: { status: 'empty' },
      evening: { status: 'empty' },
    },
  }
}

describe('DraftItinerary', () => {
  it('renders a shimmer placeholder for empty slots', () => {
    const wrapper = mount(DraftItinerary, {
      props: { days: [emptyDay(1, 'Barcelona', '2026-08-10')], budgetTotal: 1400, runningTotal: 0, filledCount: 0, totalSlots: 3 },
    })
    expect(wrapper.findAll('[data-testid="draft-slot"][data-status="empty"]')).toHaveLength(3)
    expect(wrapper.find('.skel-line').exists()).toBe(true)
  })

  it('renders activity name and owning agent for a filled slot', () => {
    const day = emptyDay(1, 'Barcelona', '2026-08-10')
    day.slots.morning = { status: 'filled', name: 'Mercat de Sta Caterina', by: 'diana', color: 'magenta', cost: 14 }
    const wrapper = mount(DraftItinerary, {
      props: { days: [day], budgetTotal: 1400, runningTotal: 14, filledCount: 1, totalSlots: 3 },
    })
    const filled = wrapper.find('[data-testid="filled-slot"]')
    expect(filled.text()).toContain('Mercat de Sta Caterina')
    expect(filled.text()).toContain('diana')
    expect(filled.text()).toContain('orchestrator accepted')
  })

  it('renders a reserved-by-logistics slot distinctly from empty and filled', () => {
    const day = emptyDay(1, 'Barcelona', '2026-08-10')
    day.slots.morning = { status: 'reserved', name: 'Arrival travel', by: 'logistics', color: 'blue' }
    const wrapper = mount(DraftItinerary, {
      props: { days: [day], budgetTotal: 1400, runningTotal: 0, filledCount: 0, totalSlots: 3 },
    })
    const reserved = wrapper.find('[data-testid="reserved-slot"]')
    expect(reserved.exists()).toBe(true)
    expect(reserved.text()).toContain('Arrival travel')
    expect(reserved.text()).toContain('logistics')
    expect(wrapper.find('[data-testid="filled-slot"]').exists()).toBe(false)
    const reservedRow = wrapper.find('[data-testid="draft-slot"][data-status="reserved"]')
    expect(reservedRow.find('.skel-line').exists()).toBe(false)
  })

  it('counts reserved slots in the per-day counter alongside filled ones', () => {
    const day = emptyDay(4, 'Barcelona', '2026-08-12')
    day.slots.morning = { status: 'filled', name: 'Mercat de Sta Caterina', by: 'diana', color: 'magenta', cost: 14 }
    day.slots.afternoon = { status: 'reserved', name: 'Departure travel', by: 'logistics', color: 'blue' }
    // evening stays empty
    const wrapper = mount(DraftItinerary, {
      props: { days: [day], budgetTotal: 1400, runningTotal: 14, filledCount: 1, totalSlots: 3 },
    })
    expect(wrapper.text()).toContain('2/3')
  })

  it('shows filled/total slot count and per-day counters', () => {
    const wrapper = mount(DraftItinerary, {
      props: { days: [emptyDay(1, 'Barcelona', '2026-08-10')], budgetTotal: 1400, runningTotal: 0, filledCount: 2, totalSlots: 9 },
    })
    expect(wrapper.find('[data-testid="slot-count"]').text()).toBe('2 / 9 slots')
  })

  it('shows the running total and budget in the footer', () => {
    const wrapper = mount(DraftItinerary, {
      props: { days: [], budgetTotal: 1400, runningTotal: 69, filledCount: 3, totalSlots: 9 },
    })
    const total = wrapper.find('[data-testid="running-total"]')
    expect(total.text()).toContain('€69')
    expect(total.text()).toContain('budget €1,400')
    expect(wrapper.text()).toContain('running total / pp (3/9 slots)')
  })

  it('keeps the footer label reading as a running total, not a final one, even when every slot is filled', () => {
    const wrapper = mount(DraftItinerary, {
      props: { days: [], budgetTotal: 1400, runningTotal: 742, filledCount: 9, totalSlots: 9 },
    })
    expect(wrapper.text()).toContain('running total / pp (9/9 slots)')
  })

  it('shows the real decision status (e.g. "merged") instead of always saying "accepted"', () => {
    const day = emptyDay(1, 'Barcelona', '2026-08-10')
    day.slots.morning = { status: 'filled', name: 'Collserola guided hike', by: 'carlos', color: 'blue', cost: 0, decisionStatus: 'merged', reason: 'combined with a local guide add-on' }
    const wrapper = mount(DraftItinerary, {
      props: { days: [day], budgetTotal: 1400, runningTotal: 0, filledCount: 1, totalSlots: 3 },
    })
    expect(wrapper.find('[data-testid="filled-slot"]').text()).toContain('orchestrator merged')
  })

  it('clicking a filled slot toggles the reason panel open, then closed again', async () => {
    const day = emptyDay(1, 'Barcelona', '2026-08-10')
    day.slots.morning = { status: 'filled', name: 'Mercat de Sta Caterina', by: 'diana', color: 'magenta', cost: 14, decisionStatus: 'accepted', reason: 'best fit for the morning budget block' }
    const wrapper = mount(DraftItinerary, {
      props: { days: [day], budgetTotal: 1400, runningTotal: 14, filledCount: 1, totalSlots: 3 },
    })

    expect(wrapper.find('[data-testid="slot-reason"]').exists()).toBe(false)

    await wrapper.find('[data-testid="filled-slot"]').trigger('click')
    expect(wrapper.find('[data-testid="slot-reason"]').text()).toBe('best fit for the morning budget block')

    await wrapper.find('[data-testid="filled-slot"]').trigger('click')
    expect(wrapper.find('[data-testid="slot-reason"]').exists()).toBe(false)
  })

  it('keyboard Enter toggles the reason panel, falling back to a generic message when no reason is available', async () => {
    const day = emptyDay(1, 'Barcelona', '2026-08-10')
    // No `reason` — e.g. the agent.merge fallback path, which has no per-slot reason to attach.
    day.slots.morning = { status: 'filled', name: 'Mercat de Sta Caterina', by: 'diana', color: 'magenta', cost: 14, decisionStatus: 'accepted' }
    const wrapper = mount(DraftItinerary, {
      props: { days: [day], budgetTotal: 1400, runningTotal: 14, filledCount: 1, totalSlots: 3 },
    })

    await wrapper.find('[data-testid="filled-slot"]').trigger('keydown.enter')
    expect(wrapper.find('[data-testid="slot-reason"]').text()).toBe('No detailed reasoning available for this decision.')
  })

  it('still renders its content when the parent applies a mobile-hidden class (visibility is CSS-only, not conditional rendering)', () => {
    const day = emptyDay(1, 'Barcelona', '2026-08-10')
    day.slots.morning = { status: 'filled', name: 'Mercat de Sta Caterina', by: 'diana', color: 'magenta', cost: 14 }
    const wrapper = mount(DraftItinerary, {
      props: { days: [day], budgetTotal: 1400, runningTotal: 14, filledCount: 1, totalSlots: 3 },
      attrs: { class: 'panel-hidden' },
    })
    expect(wrapper.classes()).toContain('panel-hidden')
    expect(wrapper.find('[data-testid="filled-slot"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('Mercat de Sta Caterina')
  })
})

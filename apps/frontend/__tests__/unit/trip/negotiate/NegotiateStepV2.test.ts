import { describe, it, expect, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import NegotiateStepV2 from '~/components/trip/negotiate/NegotiateStepV2.vue'
import AgentList from '~/components/trip/negotiate/AgentList.vue'
import DecisionStream from '~/components/trip/negotiate/DecisionStream.vue'
import DraftItinerary from '~/components/trip/negotiate/DraftItinerary.vue'
import { useNegotiationStore } from '~/stores/negotiation'

function mountStep() {
  return mount(NegotiateStepV2, {
    props: {
      tripId: null,
      budgetTotal: 1400,
      negotiationStatus: 'negotiating',
      rejectionReason: '',
    },
  })
}

describe('NegotiateStepV2 — mobile panel switcher', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('defaults to the "activity" panel on mobile: activity visible, agents/itinerary hidden', () => {
    const wrapper = mountStep()
    expect(wrapper.find('[data-testid="mobile-panel-tab-activity"]').classes()).toContain('on')
    expect(wrapper.findComponent(DecisionStream).classes()).not.toContain('panel-hidden')
    expect(wrapper.findComponent(AgentList).classes()).toContain('panel-hidden')
    expect(wrapper.findComponent(DraftItinerary).classes()).toContain('panel-hidden')
  })

  it('tapping the agents tab shows AgentList and hides the other two panels', async () => {
    const wrapper = mountStep()
    await wrapper.find('[data-testid="mobile-panel-tab-agents"]').trigger('click')

    expect(wrapper.find('[data-testid="mobile-panel-tab-agents"]').classes()).toContain('on')
    expect(wrapper.findComponent(AgentList).classes()).not.toContain('panel-hidden')
    expect(wrapper.findComponent(DecisionStream).classes()).toContain('panel-hidden')
    expect(wrapper.findComponent(DraftItinerary).classes()).toContain('panel-hidden')
  })

  it('tapping the itinerary tab shows DraftItinerary and hides the other two panels', async () => {
    const wrapper = mountStep()
    await wrapper.find('[data-testid="mobile-panel-tab-itinerary"]').trigger('click')

    expect(wrapper.find('[data-testid="mobile-panel-tab-itinerary"]').classes()).toContain('on')
    expect(wrapper.findComponent(DraftItinerary).classes()).not.toContain('panel-hidden')
    expect(wrapper.findComponent(AgentList).classes()).toContain('panel-hidden')
    expect(wrapper.findComponent(DecisionStream).classes()).toContain('panel-hidden')
  })

  it('switching tabs does not remount DraftItinerary — internal expanded-reason state survives', async () => {
    const wrapper = mountStep()
    const store = useNegotiationStore()
    store.state.slots = [{
      day: 1,
      date: '2026-08-10',
      city: 'Barcelona',
      slots: {
        morning: { status: 'filled', name: 'Mercat de Sta Caterina', by: 'diana', color: 'magenta', cost: 14, reason: 'best fit for the morning budget block' },
        afternoon: { status: 'empty' },
        evening: { status: 'empty' },
      },
    }]
    await wrapper.vm.$nextTick()

    // Switch to the itinerary tab and expand a slot's reason.
    await wrapper.find('[data-testid="mobile-panel-tab-itinerary"]').trigger('click')
    await wrapper.find('[data-testid="filled-slot"]').trigger('click')
    expect(wrapper.find('[data-testid="slot-reason"]').exists()).toBe(true)

    const draftItineraryEl = wrapper.findComponent(DraftItinerary).element

    // Switch away and back — the same DOM node (and thus component instance) should
    // survive, proving visibility is CSS-toggled rather than a v-if remount.
    await wrapper.find('[data-testid="mobile-panel-tab-agents"]').trigger('click')
    await wrapper.find('[data-testid="mobile-panel-tab-itinerary"]').trigger('click')

    expect(wrapper.findComponent(DraftItinerary).element).toBe(draftItineraryEl)
    expect(wrapper.find('[data-testid="slot-reason"]').exists()).toBe(true)
  })
})

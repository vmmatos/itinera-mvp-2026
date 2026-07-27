import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import NegotiationQuality from '~/components/trip/itinerary/NegotiationQuality.vue'

describe('NegotiationQuality', () => {
  it('renders fairness, satisfaction, constraints, timing conflicts and rounds when all present', () => {
    const wrapper = mount(NegotiationQuality, {
      props: { fairnessScore: 100, satisfactionScore: 92, constraintsPassed: true, timingConflicts: 0, rounds: 2 },
    })
    expect(wrapper.text()).toContain('100%')
    expect(wrapper.text()).toContain('92%')
    expect(wrapper.text()).toContain('✓ passed')
    expect(wrapper.text()).toContain('0 detected')
    expect(wrapper.text()).toContain('2')
  })

  it('hides rows whose data is not yet available (no validator proposal), does not crash', () => {
    const wrapper = mount(NegotiationQuality, {
      props: { fairnessScore: null, satisfactionScore: null, constraintsPassed: null, timingConflicts: 0, rounds: null },
    })
    expect(wrapper.find('.q-row').exists()).toBe(false)
    expect(wrapper.text()).toContain('Timing conflicts')
  })

  it('marks a failed constraints check distinctly from passed', () => {
    const wrapper = mount(NegotiationQuality, {
      props: { fairnessScore: null, satisfactionScore: null, constraintsPassed: false, timingConflicts: 1, rounds: null },
    })
    expect(wrapper.text()).toContain('✗ failed')
  })
})

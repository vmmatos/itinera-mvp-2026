import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import DecisionStream from '~/components/trip/negotiate/DecisionStream.vue'
import type { DecisionStreamEvent } from '~/types/index'

function event(overrides: Partial<DecisionStreamEvent> = {}): DecisionStreamEvent {
  return {
    id: 'diana:Barcelona:2026-08-10:morning',
    who: 'diana',
    color: 'magenta',
    kind: 'agent · propose',
    body: 'Mercat de Sta Caterina — tapas breakfast',
    facts: [['cost', '€14/pp'], ['slot', 'Barcelona · morning']],
    chip: 'pending',
    timestamp: '2026-08-10T09:00:00Z',
    ...overrides,
  }
}

describe('DecisionStream', () => {
  it('renders one card per event, oldest first, and a stream tail', () => {
    const wrapper = mount(DecisionStream, {
      props: {
        events: [event({ id: 'a', body: 'first' }), event({ id: 'b', body: 'second' })],
        sessionStatus: 'negotiating',
      },
    })
    const cards = wrapper.findAll('[data-testid="decision-event"]')
    expect(cards).toHaveLength(2)
    expect(cards[0]!.text()).toContain('first')
    expect(cards[1]!.text()).toContain('second')
    expect(wrapper.find('[data-testid="stream-tail"]').text()).toContain('orchestrator evaluating')
  })

  it('shows "awaiting orchestrator" for a pending chip', () => {
    const wrapper = mount(DecisionStream, { props: { events: [event({ chip: 'pending' })], sessionStatus: 'negotiating' } })
    expect(wrapper.find('[data-testid="chip"]').text()).toBe('awaiting orchestrator')
  })

  it.each([
    ['accepted', 'accepted'],
    ['merged', 'merged'],
    ['rejected', 'rejected'],
    ['applied', 'applied'],
  ] as const)('shows the chip label as-is for a resolved status: %s', (chip, label) => {
    const wrapper = mount(DecisionStream, { props: { events: [event({ chip })], sessionStatus: 'negotiating' } })
    expect(wrapper.find('[data-testid="chip"]').text()).toBe(label)
  })

  it('renders the decision reason line only when present', () => {
    const withReason = mount(DecisionStream, {
      props: { events: [event({ chip: 'accepted', decisionReason: 'top group weight' })], sessionStatus: 'negotiating' },
    })
    expect(withReason.text()).toContain('top group weight')

    const withoutReason = mount(DecisionStream, { props: { events: [event({ chip: 'pending' })], sessionStatus: 'negotiating' } })
    expect(withoutReason.text()).not.toContain('orchestrator ·')
  })

  it('flips the stream tail to complete once the session is done', () => {
    const wrapper = mount(DecisionStream, { props: { events: [], sessionStatus: 'complete' } })
    expect(wrapper.find('[data-testid="stream-tail"]').text()).toContain('session complete')
  })
})

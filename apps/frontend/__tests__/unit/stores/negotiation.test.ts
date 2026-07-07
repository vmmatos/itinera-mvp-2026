import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { ref, computed, type Ref } from 'vue'
import { useNegotiationStore } from '~/stores/negotiation'
import type { AgentStreamEvent } from '~/types/index'

// useNegotiationStore.connect() calls the globally-shimmed useAgentStream
// (see __tests__/setup.ts) — override it per test with a real ref so the
// store's `watch(stream.events, ...)` reacts like it would at runtime.
function mockAgentStream() {
  const events = ref<AgentStreamEvent[]>([])
  const connected = ref(false)
  // @ts-expect-error global shim override
  globalThis.useAgentStream = vi.fn(() => ({ events, connected }))
  return { events, connected }
}

function emit(events: Ref<AgentStreamEvent[]>, evt: AgentStreamEvent): void {
  // useAgentStream prepends newest-first — mirror that here.
  events.value = [evt, ...events.value]
}

describe('useNegotiationStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('happy path: processes a scripted sequence of events into stages/agents/slots/events', () => {
    const { events } = mockAgentStream()
    const store = useNegotiationStore()
    store.connect(computed(() => 'trip-1'), 1400)

    emit(events, { tripId: 'trip-1', type: 'workflow.logistics_planning', agent: 'orchestrator', round: 1, timestamp: 't1', content: { state: 'LOGISTICS_PLANNING' } })
    emit(events, {
      tripId: 'trip-1', type: 'agent.plan', agent: 'logistics', round: 1, timestamp: 't2',
      content: { cityStays: [{ city: 'Barcelona', arrivalDate: '2026-08-10', departureDate: '2026-08-11' }] },
    })
    emit(events, {
      tripId: 'trip-1', type: 'agent.propose', agent: 'diana', round: 1, timestamp: 't3',
      content: { slotProposals: [{ city: 'Barcelona', date: '2026-08-10', slot: 'morning', activity: 'Mercat', venue: 'Mercat', estimatedCostPerPerson: 14 }] },
    })
    emit(events, {
      tripId: 'trip-1', type: 'agent.decision', agent: 'diana', round: 1, timestamp: 't4',
      content: { agent: 'diana', city: 'Barcelona', date: '2026-08-10', slot: 'morning', activity: 'Mercat', status: 'accepted', reason: 'ok', estimatedCostPerPerson: 14 },
    })

    expect(store.state.stages[0]!.status).toBe('running')
    expect(store.state.slots).toHaveLength(1)
    expect(store.filledCount).toBe(1)
    expect(store.runningTotal).toBe(14)
    expect(store.state.events.some((e) => e.chip === 'accepted')).toBe(true)
  })

  it('does not reset accumulated state when the underlying SSE connection flips', () => {
    const { events, connected } = mockAgentStream()
    const store = useNegotiationStore()
    store.connect(computed(() => 'trip-1'))

    emit(events, { tripId: 'trip-1', type: 'negotiation_complete', agent: 'orchestrator', round: 1, timestamp: 't1', content: {} })
    expect(store.state.session.status).toBe('complete')

    // Transport disconnects/reconnects — connected flips, events array is untouched by useAgentStream itself.
    connected.value = false
    connected.value = true

    expect(store.state.session.status).toBe('complete')
  })

  it('ignores a malformed event without throwing', () => {
    const { events } = mockAgentStream()
    const store = useNegotiationStore()
    store.connect(computed(() => 'trip-1'))

    expect(() => {
      emit(events, { tripId: 'trip-1', type: 'agent.decision', agent: 'diana', round: 1, timestamp: 't1', content: null })
    }).not.toThrow()
    expect(store.state.events).toHaveLength(0)
  })

  it('a rejected proposal never fills a draft slot', () => {
    const { events } = mockAgentStream()
    const store = useNegotiationStore()
    store.connect(computed(() => 'trip-1'))

    emit(events, {
      tripId: 'trip-1', type: 'agent.plan', agent: 'logistics', round: 1, timestamp: 't1',
      content: { cityStays: [{ city: 'Barcelona', arrivalDate: '2026-08-10', departureDate: '2026-08-11' }] },
    })
    emit(events, {
      tripId: 'trip-1', type: 'agent.propose', agent: 'bob', round: 1, timestamp: 't2',
      content: { slotProposals: [{ city: 'Barcelona', date: '2026-08-10', slot: 'evening', activity: 'Razzmatazz', estimatedCostPerPerson: 28 }] },
    })
    emit(events, {
      tripId: 'trip-1', type: 'agent.decision', agent: 'bob', round: 1, timestamp: 't3',
      content: { agent: 'bob', city: 'Barcelona', date: '2026-08-10', slot: 'evening', activity: 'Razzmatazz', status: 'rejected', reason: 'low weight' },
    })

    expect(store.filledCount).toBe(0)
    expect(store.state.slots[0]!.slots.evening.status).toBe('empty')
  })

  it('sweeps a stuck pending proposal to rejected after the grace period once merge is done', () => {
    const { events } = mockAgentStream()
    const store = useNegotiationStore()
    store.connect(computed(() => 'trip-1'))

    emit(events, {
      tripId: 'trip-1', type: 'agent.propose', agent: 'diana', round: 1, timestamp: 't1',
      content: { slotProposals: [{ city: 'Barcelona', date: '2026-08-10', slot: 'morning', activity: 'Mercat', estimatedCostPerPerson: 14 }] },
    })
    expect(store.state.events[0]!.chip).toBe('pending')

    // MERGE_AND_SCORE is stage index 3 — its transition to "done" is signalled
    // by the *next* stage's workflow event, per the real backend sequence.
    emit(events, { tripId: 'trip-1', type: 'workflow.finance_validate', agent: 'orchestrator', round: 1, timestamp: 't2', content: { state: 'FINANCE_VALIDATE' } })
    expect(store.state.stages[3]!.status).toBe('done')

    vi.advanceTimersByTime(8000)

    expect(store.state.events[0]!.chip).toBe('rejected')
  })

  it('reset() clears accumulated state back to a fresh session', () => {
    const { events } = mockAgentStream()
    const store = useNegotiationStore()
    store.connect(computed(() => 'trip-1'))
    emit(events, { tripId: 'trip-1', type: 'negotiation_complete', agent: 'orchestrator', round: 1, timestamp: 't1', content: {} })
    expect(store.state.session.status).toBe('complete')

    store.reset()

    expect(store.state.session.status).toBe('negotiating')
    expect(store.state.events).toHaveLength(0)
  })
})

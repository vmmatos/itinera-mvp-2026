import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { ref, computed, type Ref } from 'vue'
import { useNegotiationStore } from '~/stores/negotiation'
import { mockApiGet } from '../../setup'
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

// ── connect() REST backfill (recovers from a missed live agent.plan event) ──
// Uses real timers — these tests need setTimeout to actually flush the
// microtask queue after connect()'s fire-and-forget hydrateFromProposals().
describe('useNegotiationStore — proposals backfill on connect()', () => {
  beforeEach(() => {
    vi.useRealTimers()
    mockApiGet.mockReset()
  })

  it('happy path: seeds the Draft Itinerary and logistics card when the live agent.plan event never arrives', async () => {
    mockAgentStream() // no SSE events emitted — simulates a client that connected too late
    mockApiGet.mockResolvedValueOnce({
      data: {
        success: true,
        data: [
          {
            agent: 'logistics',
            content: { cityStays: [{ city: 'Dublin', arrivalDate: '2026-08-18', departureDate: '2026-08-22', timeWindows: [] }] },
            createdAt: '2026-08-01T10:00:00Z',
          },
        ],
      },
    })

    const store = useNegotiationStore()
    store.connect(computed(() => 'trip-1'))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(mockApiGet).toHaveBeenCalledWith('/api/v1/trips/trip-1/proposals')
    expect(store.state.agents.find((a) => a.id === 'logistics')!.lastAction).toBe('sent route plan')
    expect(store.state.slots.length).toBeGreaterThan(0)
  })

  it('does not overwrite state seeded live by the SSE stream first', async () => {
    const { events } = mockAgentStream()
    mockApiGet.mockResolvedValueOnce({
      data: { success: true, data: [{ agent: 'logistics', content: { cityStays: [{ city: 'Porto', arrivalDate: '2026-08-01', departureDate: '2026-08-03' }] } }] },
    })

    const store = useNegotiationStore()
    store.connect(computed(() => 'trip-1'))
    emit(events, {
      tripId: 'trip-1', type: 'agent.plan', agent: 'logistics', round: 1, timestamp: 'live-1',
      content: { cityStays: [{ city: 'Barcelona', arrivalDate: '2026-08-10', departureDate: '2026-08-11' }] },
    })
    const liveSlots = store.state.slots
    await new Promise((resolve) => setTimeout(resolve, 0))

    // The REST backfill resolved after the live event already won — must not clobber it.
    expect(store.state.slots).toBe(liveSlots)
    expect(store.state.slots[0]!.city).toBe('Barcelona')
  })

  it('error path: does not throw and leaves state untouched when the proposals fetch rejects', async () => {
    mockAgentStream()
    mockApiGet.mockRejectedValueOnce(new Error('network error'))

    const store = useNegotiationStore()
    expect(() => store.connect(computed(() => 'trip-1'))).not.toThrow()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(store.state.slots).toHaveLength(0)
  })

  it('a superseded connect() does not let a late-resolving fetch mutate the new session', async () => {
    mockAgentStream()
    let resolveFirst!: (v: unknown) => void
    mockApiGet.mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve }))

    const store = useNegotiationStore()
    store.connect(computed(() => 'trip-1'))
    // Reconnect before the first fetch resolves — simulates navigating to a different trip fast.
    mockApiGet.mockResolvedValueOnce({ data: { success: true, data: [] } })
    store.connect(computed(() => 'trip-2'))

    resolveFirst({
      data: { success: true, data: [{ agent: 'logistics', content: { cityStays: [{ city: 'Old trip', arrivalDate: '2026-08-01', departureDate: '2026-08-02' }] } }] },
    })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(store.state.slots).toHaveLength(0)
  })
})

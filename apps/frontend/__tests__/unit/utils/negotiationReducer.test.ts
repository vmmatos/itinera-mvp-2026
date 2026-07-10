import { describe, it, expect } from 'vitest'
import {
  createInitialNegotiationState,
  reconcile,
  sweepPendingEvents,
  filledSlotCount,
  runningTotal,
  colorFor,
  WORKFLOW_STAGE_ORDER,
} from '~/utils/negotiationReducer'
import type { AgentStreamEvent, AgentName } from '~/types/index'

const TRIP_ID = 'trip-1'

function workflowEvent(state: string, t = 1): AgentStreamEvent {
  return { tripId: TRIP_ID, type: `workflow.${state.toLowerCase()}`, agent: 'orchestrator', round: 1, timestamp: `t${t}`, content: { state } }
}

function planEvent(t = 1): AgentStreamEvent {
  return {
    tripId: TRIP_ID, type: 'agent.plan', agent: 'logistics', round: 1, timestamp: `t${t}`,
    content: {
      cityStays: [
        { city: 'Barcelona', arrivalDate: '2026-08-10', departureDate: '2026-08-12' },
        { city: 'Mértola', arrivalDate: '2026-08-12', departureDate: '2026-08-13' },
      ],
    },
  }
}

function planEventWithWindows(t = 1): AgentStreamEvent {
  return {
    tripId: TRIP_ID, type: 'agent.plan', agent: 'logistics', round: 1, timestamp: `t${t}`,
    content: {
      cityStays: [
        {
          city: 'Barcelona', arrivalDate: '2026-08-10', departureDate: '2026-08-12',
          timeWindows: [
            { date: '2026-08-10', slot: 'morning', isTransitDay: true, blockedReason: 'inbound-transit' },
            { date: '2026-08-10', slot: 'afternoon' },
            { date: '2026-08-10', slot: 'evening' },
            { date: '2026-08-11', slot: 'morning' },
            { date: '2026-08-11', slot: 'afternoon' },
            { date: '2026-08-11', slot: 'evening' },
            // Outbound-transit day owned by Barcelona, on its own departureDate —
            // excluded by the old nights-loop, must still get a day-card.
            { date: '2026-08-12', slot: 'morning' },
            { date: '2026-08-12', slot: 'afternoon', isTransitDay: true, blockedReason: 'outbound-transit' },
            { date: '2026-08-12', slot: 'evening', isTransitDay: true, blockedReason: 'outbound-transit' },
          ],
        },
        {
          city: 'Mértola', arrivalDate: '2026-08-12', departureDate: '2026-08-13',
          timeWindows: [
            { date: '2026-08-13', slot: 'morning' },
            { date: '2026-08-13', slot: 'afternoon' },
            { date: '2026-08-13', slot: 'evening' },
          ],
        },
      ],
    },
  }
}

function proposeEvent(agent: AgentName, t = 1): AgentStreamEvent {
  return {
    tripId: TRIP_ID, type: 'agent.propose', agent, round: 1, timestamp: `t${t}`,
    content: {
      slotProposals: [
        { city: 'Barcelona', date: '2026-08-10', slot: 'morning', activity: 'Mercat de Sta Caterina', venue: 'Mercat', estimatedCostPerPerson: 14 },
      ],
    },
  }
}

function decisionEvent(agent: AgentName, status: 'accepted' | 'merged' | 'rejected', t = 1): AgentStreamEvent {
  return {
    tripId: TRIP_ID, type: 'agent.decision', agent, round: 1, timestamp: `t${t}`,
    content: {
      agent, city: 'Barcelona', date: '2026-08-10', slot: 'morning', activity: 'Mercat de Sta Caterina',
      status, reason: 'test reason', estimatedCostPerPerson: 14,
    },
  }
}

describe('negotiationReducer.reconcile — happy path', () => {
  it('advances stages through workflow.* events in order', () => {
    const state = createInitialNegotiationState(1400)
    reconcile(state, workflowEvent('LOGISTICS_PLANNING'))
    expect(state.stages[0]!.status).toBe('running')
    expect(state.stages.slice(1).every((s) => s.status === 'queued')).toBe(true)

    reconcile(state, workflowEvent('FINANCE_ENVELOPE_CHECK'))
    expect(state.stages[0]!.status).toBe('done')
    expect(state.stages[1]!.status).toBe('running')
  })

  it('marks active agents thinking for the current stage', () => {
    const state = createInitialNegotiationState()
    reconcile(state, workflowEvent('PARALLEL_TURISTIC_PLANNING'))
    const alice = state.agents.find((a) => a.id === 'alice')!
    const logistics = state.agents.find((a) => a.id === 'logistics')!
    expect(alice.state).toBe('thinking')
    expect(logistics.state).toBe('idle')
  })

  it('builds the draft slot grid from agent.plan cityStays', () => {
    const state = createInitialNegotiationState()
    reconcile(state, planEvent())
    expect(state.slots).toHaveLength(3) // 2 nights Barcelona + 1 night Mértola
    expect(state.slots[0]!.city).toBe('Barcelona')
    expect(state.slots[0]!.day).toBe(1)
    expect(state.slots[2]!.city).toBe('Mértola')
  })

  it('builds reserved transit slots from agent.plan timeWindows, including the outbound-transit day the nights-loop would exclude', () => {
    const state = createInitialNegotiationState()
    reconcile(state, planEventWithWindows())

    expect(state.slots).toHaveLength(4) // 3 Barcelona days (incl. departureDate) + 1 Mértola day
    const arrivalDay = state.slots.find((d) => d.date === '2026-08-10')!
    expect(arrivalDay.slots.morning).toEqual({
      status: 'reserved', name: 'Arrival travel', by: 'logistics', color: colorFor('logistics'),
    })
    expect(arrivalDay.slots.afternoon.status).toBe('empty')

    const departureDay = state.slots.find((d) => d.date === '2026-08-12')!
    expect(departureDay.city).toBe('Barcelona')
    expect(departureDay.slots.morning.status).toBe('empty')
    expect(departureDay.slots.afternoon).toEqual({
      status: 'reserved', name: 'Departure travel', by: 'logistics', color: colorFor('logistics'),
    })
    expect(departureDay.slots.evening.name).toBe('Departure travel')
  })

  it('falls back to plain empty slots when agent.plan has no timeWindows (legacy payload)', () => {
    const state = createInitialNegotiationState()
    reconcile(state, planEvent())
    expect(state.slots).toHaveLength(3)
    expect(state.slots.every((d) => Object.values(d.slots).every((s) => s.status === 'empty'))).toBe(true)
  })

  it('agent.propose creates a pending decision-stream event keyed by agent:city:date:slot', () => {
    const state = createInitialNegotiationState()
    reconcile(state, proposeEvent('diana'))
    expect(state.events).toHaveLength(1)
    expect(state.events[0]!.chip).toBe('pending')
    expect(state.events[0]!.id).toBe('diana:Barcelona:2026-08-10:morning')
    expect(state.agents.find((a) => a.id === 'diana')!.state).toBe('proposing')
  })

  it('agent.decision resolves the matching pending event and fills the slot when accepted', () => {
    const state = createInitialNegotiationState()
    reconcile(state, planEvent())
    reconcile(state, proposeEvent('diana'))
    reconcile(state, decisionEvent('diana', 'accepted'))

    const proposalEvent = state.events.find((e) => e.id === 'diana:Barcelona:2026-08-10:morning')!
    expect(proposalEvent.chip).toBe('accepted')
    expect(proposalEvent.decisionReason).toBe('test reason')
    const slot = state.slots[0]!.slots.morning
    expect(slot.status).toBe('filled')
    expect(slot.name).toBe('Mercat de Sta Caterina')
    expect(slot.by).toBe('diana')
    expect(slot.cost).toBe(14)
  })

  it('workflow.finish marks every stage done (terminal state has no pipeline cell of its own)', () => {
    const state = createInitialNegotiationState()
    reconcile(state, workflowEvent('FINAL_VALIDATION'))
    expect(state.stages[5]!.status).toBe('running')

    reconcile(state, workflowEvent('FINISH'))

    expect(state.stages.every((s) => s.status === 'done')).toBe(true)
    expect(state.agents.every((a) => a.state === 'idle')).toBe(true)
  })

  it('negotiation_complete marks the session complete', () => {
    const state = createInitialNegotiationState()
    reconcile(state, { tripId: TRIP_ID, type: 'negotiation_complete', agent: 'orchestrator', round: 1, timestamp: 't1', content: {} })
    expect(state.session.status).toBe('complete')
  })

  it('full script end-to-end: stages done, slot filled, running total correct', () => {
    const state = createInitialNegotiationState(1400)
    reconcile(state, workflowEvent('LOGISTICS_PLANNING'))
    reconcile(state, planEvent())
    WORKFLOW_STAGE_ORDER.forEach((s) => reconcile(state, workflowEvent(s)))
    reconcile(state, proposeEvent('diana'))
    reconcile(state, decisionEvent('diana', 'accepted'))
    reconcile(state, workflowEvent('FINISH'))

    expect(state.stages.every((s) => s.status === 'done')).toBe(true)
    expect(filledSlotCount(state)).toBe(1)
    expect(runningTotal(state)).toBe(14)
  })
})

describe('negotiationReducer.reconcile — error / edge scenarios', () => {
  it('unrecognised blockedReason does not throw and falls back to a generic label', () => {
    const state = createInitialNegotiationState()
    expect(() => reconcile(state, {
      tripId: TRIP_ID, type: 'agent.plan', agent: 'logistics', round: 1, timestamp: 't1',
      content: {
        cityStays: [{
          city: 'Barcelona', arrivalDate: '2026-08-10', departureDate: '2026-08-11',
          timeWindows: [
            { date: '2026-08-10', slot: 'morning', isTransitDay: true, blockedReason: 'something-new' },
            { date: '2026-08-10', slot: 'afternoon' },
            { date: '2026-08-10', slot: 'evening' },
          ],
        }],
      },
    })).not.toThrow()
    expect(state.slots[0]!.slots.morning).toEqual({
      status: 'reserved', name: 'Reserved by logistics', by: 'logistics', color: colorFor('logistics'),
    })
  })

  it('a reserved transit slot is never overwritten by a later agent.decision', () => {
    const state = createInitialNegotiationState()
    reconcile(state, planEventWithWindows())
    reconcile(state, {
      tripId: TRIP_ID, type: 'agent.decision', agent: 'diana', round: 1, timestamp: 't2',
      content: {
        agent: 'diana', city: 'Barcelona', date: '2026-08-10', slot: 'morning', activity: 'Sneaky brunch',
        status: 'accepted', reason: 'squeezed in', estimatedCostPerPerson: 20,
      },
    })
    expect(state.slots[0]!.slots.morning.status).toBe('reserved')
    expect(state.slots[0]!.slots.morning.name).toBe('Arrival travel')
  })

  it('a reserved transit slot is never overwritten by the agent.merge fallback', () => {
    const state = createInitialNegotiationState()
    reconcile(state, planEventWithWindows())
    reconcile(state, {
      tripId: TRIP_ID, type: 'agent.merge', agent: 'orchestrator', round: 1, timestamp: 't2',
      content: {
        itinerary: [{
          day: 1,
          activities: [{ ownerAgent: 'diana', activity: 'Sneaky brunch', time: 'morning', estimatedCostPerPerson: 20 }],
        }],
      },
    })
    expect(state.slots[0]!.slots.morning.status).toBe('reserved')
  })

  it('rejected proposal never fills a slot', () => {
    const state = createInitialNegotiationState()
    reconcile(state, planEvent())
    reconcile(state, proposeEvent('diana'))
    reconcile(state, decisionEvent('diana', 'rejected'))

    expect(state.events.find((e) => e.id === 'diana:Barcelona:2026-08-10:morning')!.chip).toBe('rejected')
    expect(state.slots[0]!.slots.morning.status).toBe('empty')
  })

  it('merged proposal fills the slot (not just accepted)', () => {
    const state = createInitialNegotiationState()
    reconcile(state, planEvent())
    reconcile(state, proposeEvent('carlos'))
    reconcile(state, decisionEvent('carlos', 'merged'))

    expect(state.slots[0]!.slots.morning.status).toBe('filled')
  })

  it('unrecognised event type is ignored without throwing', () => {
    const state = createInitialNegotiationState()
    const before = JSON.stringify(state)
    expect(() => reconcile(state, {
      tripId: TRIP_ID, type: 'some.unknown.event', agent: 'orchestrator', round: 1, timestamp: 't1', content: {},
    })).not.toThrow()
    // Only lastEventAt/startedAt (timestamps) may change — structural state must not
    const after = JSON.parse(JSON.stringify(state))
    const beforeParsed = JSON.parse(before)
    expect(after.stages).toEqual(beforeParsed.stages)
    expect(after.agents).toEqual(beforeParsed.agents)
    expect(after.events).toEqual(beforeParsed.events)
    expect(after.slots).toEqual(beforeParsed.slots)
  })

  it('malformed content (null) does not throw and is ignored', () => {
    const state = createInitialNegotiationState()
    expect(() => reconcile(state, {
      tripId: TRIP_ID, type: 'agent.decision', agent: 'diana', round: 1, timestamp: 't1', content: null,
    })).not.toThrow()
    expect(state.events).toHaveLength(0)
  })

  it('malformed content (wrong shape) does not throw and is ignored', () => {
    const state = createInitialNegotiationState()
    expect(() => reconcile(state, {
      tripId: TRIP_ID, type: 'agent.propose', agent: 'alice', round: 1, timestamp: 't1', content: 'not an object',
    })).not.toThrow()
    expect(state.events).toHaveLength(0)
  })

  it('agent.merge fallback resolves still-pending proposals and fills slots when no agent.decision arrived', () => {
    const state = createInitialNegotiationState()
    reconcile(state, planEvent())
    reconcile(state, proposeEvent('diana'))
    // No agent.decision event — only the aggregate merge event arrives.
    reconcile(state, {
      tripId: TRIP_ID, type: 'agent.merge', agent: 'orchestrator', round: 1, timestamp: 't2',
      content: {
        itinerary: [
          { day: 1, activities: [{ ownerAgent: 'diana', activity: 'Mercat de Sta Caterina', time: 'morning', estimatedCostPerPerson: 14 }] },
        ],
      },
    })

    expect(state.events.find((e) => e.id === 'diana:Barcelona:2026-08-10:morning')!.chip).toBe('accepted')
    expect(state.slots[0]!.slots.morning.status).toBe('filled')
  })

  it('agent.merge fallback rejects proposals whose agent never appears in the merged itinerary', () => {
    const state = createInitialNegotiationState()
    reconcile(state, planEvent())
    reconcile(state, proposeEvent('bob'))
    reconcile(state, {
      tripId: TRIP_ID, type: 'agent.merge', agent: 'orchestrator', round: 1, timestamp: 't2',
      content: { itinerary: [{ day: 1, activities: [{ ownerAgent: 'diana', activity: 'x', time: 'morning' }] }] },
    })

    expect(state.events.find((e) => e.id === 'bob:Barcelona:2026-08-10:morning')!.chip).toBe('rejected')
  })
})

describe('sweepPendingEvents', () => {
  it('force-resolves any event still pending to rejected', () => {
    const state = createInitialNegotiationState()
    reconcile(state, proposeEvent('diana'))
    expect(state.events[0]!.chip).toBe('pending')

    sweepPendingEvents(state)

    expect(state.events[0]!.chip).toBe('rejected')
  })

  it('does not touch events that already resolved', () => {
    const state = createInitialNegotiationState()
    reconcile(state, planEvent())
    reconcile(state, proposeEvent('diana'))
    reconcile(state, decisionEvent('diana', 'accepted'))

    sweepPendingEvents(state)

    expect(state.events.find((e) => e.id === 'diana:Barcelona:2026-08-10:morning')!.chip).toBe('accepted')
  })
})

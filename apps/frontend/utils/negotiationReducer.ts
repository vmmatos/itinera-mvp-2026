// Pure state-reconciliation logic for the Negotiate v2 store (stores/negotiation.ts).
// Kept separate from the store so it's unit-testable without Pinia — see
// __tests__/unit/stores/negotiation.test.ts.
import type {
  AgentStreamEvent,
  NegotiationState,
  DecisionStreamEvent,
  DraftDay,
  ProposalDecision,
  SlotProposal,
  WorkflowState,
} from '~/types/index'

export const WORKFLOW_STAGE_ORDER: WorkflowState[] = [
  'LOGISTICS_PLANNING',
  'FINANCE_ENVELOPE_CHECK',
  'PARALLEL_TURISTIC_PLANNING',
  'MERGE_AND_SCORE',
  'FINANCE_VALIDATE',
  'FINAL_VALIDATION',
]

// Relabelled 1:1 to the real WorkflowEngine states rather than the design
// mockup's original labels (Preferences/Conflict resolution/Assembly), which
// don't correspond to any state the backend actually emits.
export const STAGE_LABELS: Record<WorkflowState, string> = {
  LOGISTICS_PLANNING: 'Logistics',
  FINANCE_ENVELOPE_CHECK: 'Finance envelope',
  PARALLEL_TURISTIC_PLANNING: 'Experiences',
  MERGE_AND_SCORE: 'Merge & resolve',
  FINANCE_VALIDATE: 'Finance validate',
  FINAL_VALIDATION: 'Final check',
}

const STATE_ACTIVE_AGENTS: Record<WorkflowState, string[]> = {
  LOGISTICS_PLANNING: ['logistics'],
  FINANCE_ENVELOPE_CHECK: ['finance'],
  PARALLEL_TURISTIC_PLANNING: ['alice', 'bob', 'carlos', 'diana'],
  MERGE_AND_SCORE: [],
  FINANCE_VALIDATE: ['finance'],
  FINAL_VALIDATION: ['validator'],
}

const AGENT_COLOR: Record<string, string> = {
  alice: 'green',
  bob: 'amber',
  carlos: 'blue',
  diana: 'magenta',
  logistics: 'blue',
  finance: 'amber',
  orchestrator: 'neutral',
  validator: 'magenta',
}

const SLOT_KEYS = ['morning', 'afternoon', 'evening'] as const

// Matches RouteGraph.TimeWindow['blockedReason'] in
// services/shared/src/types/workflow.ts — kept as a local string union rather
// than importing the backend package (this file mirrors backend types, same
// pattern as the rest of ~/types/index.ts).
type BlockedReason = 'inbound-transit' | 'inbound-recovery' | 'outbound-transit'

const TRANSIT_LABELS: Record<BlockedReason, string> = {
  'inbound-transit': 'Arrival travel',
  'inbound-recovery': 'Arrival recovery',
  'outbound-transit': 'Departure travel',
}

function transitLabel(reason: string): string {
  return TRANSIT_LABELS[reason as BlockedReason] ?? 'Reserved by logistics'
}

export function colorFor(agent: string): string {
  return AGENT_COLOR[agent] ?? 'neutral'
}

export function createInitialNegotiationState(budgetTotal = 0): NegotiationState {
  return {
    session: { status: 'negotiating', startedAt: null, lastEventAt: null },
    stages: WORKFLOW_STAGE_ORDER.map((id) => ({ id, label: STAGE_LABELS[id], status: 'queued' as const })),
    agents: [
      { id: 'alice', color: 'green', role: 'traveller' as const, state: 'idle' as const, lastAction: null, proposalCount: 0 },
      { id: 'bob', color: 'amber', role: 'traveller' as const, state: 'idle' as const, lastAction: null, proposalCount: 0 },
      { id: 'carlos', color: 'blue', role: 'traveller' as const, state: 'idle' as const, lastAction: null, proposalCount: 0 },
      { id: 'diana', color: 'magenta', role: 'traveller' as const, state: 'idle' as const, lastAction: null, proposalCount: 0 },
      { id: 'logistics', color: 'blue', role: 'service' as const, state: 'idle' as const, lastAction: null, proposalCount: 0 },
      { id: 'finance', color: 'amber', role: 'service' as const, state: 'idle' as const, lastAction: null, proposalCount: 0 },
    ],
    events: [],
    slots: [],
    budgetTotal,
  }
}

function proposalKey(agent: string, city: string, date: string, slot: string): string {
  return `${agent}:${city}:${date}:${slot}`
}

function pushOrUpdateEvent(state: NegotiationState, evt: DecisionStreamEvent): void {
  const idx = state.events.findIndex((e) => e.id === evt.id)
  if (idx >= 0) state.events[idx] = evt
  else state.events.push(evt)
}

function setAgentState(
  state: NegotiationState,
  id: string,
  agentState: 'idle' | 'thinking' | 'proposing',
  lastAction: string | null,
): void {
  const agent = state.agents.find((a) => a.id === id)
  if (!agent) return
  agent.state = agentState
  if (lastAction) agent.lastAction = lastAction
  if (agentState === 'proposing') agent.proposalCount += 1
}

interface PlanTimeWindow {
  date: string
  slot: 'morning' | 'afternoon' | 'evening'
  isTransitDay?: boolean
  blockedReason?: string
}

interface PlanCityStay {
  city: string
  arrivalDate: string
  departureDate: string
  timeWindows?: PlanTimeWindow[]
}

function emptySlots(): DraftDay['slots'] {
  return {
    morning: { status: 'empty' },
    afternoon: { status: 'empty' },
    evening: { status: 'empty' },
  }
}

// Preferred path: derive days straight from the logistics agent's own
// timeWindows, which already carry correct day-ownership (a late-departure
// transit day belongs to the origin city, not the destination — see
// WorkflowEngine.buildDayOwnership) and mark exactly which slots are
// unusable for tourist activities. This also naturally produces a day-card
// for a transit day even when it falls on a stay's departureDate, which the
// nights-loop fallback below excludes.
function buildDraftDaysFromWindows(cityStays: PlanCityStay[]): DraftDay[] {
  const baseTime = Math.min(...cityStays.map((cs) => new Date(cs.arrivalDate).getTime()))
  const byDate = new Map<string, DraftDay>()
  for (const stay of cityStays) {
    for (const w of stay.timeWindows ?? []) {
      let day = byDate.get(w.date)
      if (!day) {
        const dayNumber = Math.round((new Date(w.date).getTime() - baseTime) / 86400000) + 1
        day = { day: dayNumber, date: w.date, city: stay.city, slots: emptySlots() }
        byDate.set(w.date, day)
      }
      if (w.isTransitDay && w.blockedReason) {
        day.slots[w.slot] = {
          status: 'reserved',
          name: transitLabel(w.blockedReason),
          by: 'logistics',
          color: colorFor('logistics'),
        }
      }
    }
  }
  return Array.from(byDate.values()).sort((a, b) => a.day - b.day)
}

// Fallback for older/minimal agent.plan payloads with no timeWindows —
// reconstructs day-cards from the arrival/departure night span only.
function buildDraftDaysFromNights(cityStays: PlanCityStay[]): DraftDay[] {
  const baseTime = Math.min(...cityStays.map((cs) => new Date(cs.arrivalDate).getTime()))
  const days: DraftDay[] = []
  for (const stay of cityStays) {
    const start = new Date(stay.arrivalDate).getTime()
    const end = new Date(stay.departureDate).getTime()
    for (let t = start; t < end; t += 86400000) {
      const dayNumber = Math.round((t - baseTime) / 86400000) + 1
      const date = new Date(t).toISOString().slice(0, 10)
      days.push({ day: dayNumber, date, city: stay.city, slots: emptySlots() })
    }
  }
  return days
}

function buildDraftDays(cityStays: PlanCityStay[]): DraftDay[] {
  if (cityStays.length === 0) return []
  const hasWindows = cityStays.some((cs) => (cs.timeWindows?.length ?? 0) > 0)
  return hasWindows ? buildDraftDaysFromWindows(cityStays) : buildDraftDaysFromNights(cityStays)
}

function handleWorkflowEvent(state: NegotiationState, event: AgentStreamEvent): void {
  const content = event.content as { state?: string } | null | undefined
  // Real backend states include terminal ones (FINISH/ASK_REFINEMENT/INTAKE_COMPLETE)
  // that aren't pipeline stages — keep this as a plain string until we know it's one.
  const rawState = content?.state
  if (!rawState) return
  const idx = WORKFLOW_STAGE_ORDER.indexOf(rawState as WorkflowState)
  pushOrUpdateEvent(state, {
    id: `workflow-${event.timestamp}`,
    who: 'orchestrator',
    color: 'neutral',
    kind: 'workflow',
    body: idx !== -1 ? STAGE_LABELS[rawState as WorkflowState] : rawState,
    facts: [],
    chip: 'applied',
    timestamp: event.timestamp,
  })
  if (idx === -1) {
    // Terminal states aren't pipeline cells themselves, but FINISH means every
    // real stage completed — the last one otherwise never flips to "done"
    // since no further workflow.* event would ever mark it so.
    if (rawState === 'FINISH') {
      state.agents.forEach((a) => { a.state = 'idle' })
      state.stages.forEach((s) => { s.status = 'done' })
    }
    return
  }
  const wfState = rawState as WorkflowState
  state.stages.forEach((s, i) => {
    s.status = i < idx ? 'done' : i === idx ? 'running' : 'queued'
  })
  const activeAgents = new Set(STATE_ACTIVE_AGENTS[wfState] ?? [])
  state.agents.forEach((a) => {
    a.state = activeAgents.has(a.id) ? 'thinking' : 'idle'
  })
}

function handlePlanEvent(state: NegotiationState, event: AgentStreamEvent): void {
  setAgentState(state, 'logistics', 'idle', 'sent route plan')
  const content = event.content as { cityStays?: PlanCityStay[] } | null | undefined
  if (content?.cityStays?.length) {
    state.slots = buildDraftDays(content.cityStays)
  }
  pushOrUpdateEvent(state, {
    id: `plan-${event.timestamp}`,
    who: 'logistics',
    color: colorFor('logistics'),
    kind: 'agent · plan',
    body: 'Route plan ready',
    facts: [],
    chip: 'applied',
    timestamp: event.timestamp,
  })
}

function handleEstimateEvent(state: NegotiationState, event: AgentStreamEvent): void {
  setAgentState(state, 'finance', 'idle', 'sent budget estimate')
  pushOrUpdateEvent(state, {
    id: `estimate-${event.timestamp}`,
    who: 'finance',
    color: colorFor('finance'),
    kind: 'agent · estimate',
    body: 'Budget envelope checked',
    facts: [],
    chip: 'applied',
    timestamp: event.timestamp,
  })
}

function handleProposeEvent(state: NegotiationState, event: AgentStreamEvent): void {
  const agentId = event.agent
  const content = event.content as { slotProposals?: SlotProposal[] } | null | undefined
  const proposals = content?.slotProposals ?? []
  if (proposals.length === 0) return
  setAgentState(state, agentId, 'proposing', 'proposing activities')
  for (const p of proposals) {
    pushOrUpdateEvent(state, {
      id: proposalKey(agentId, p.city, p.date, p.slot),
      who: agentId,
      color: colorFor(agentId),
      kind: 'agent · propose',
      body: p.venue ? `${p.activity} — ${p.venue}` : p.activity,
      facts: [
        ['cost', `€${p.estimatedCostPerPerson}/pp`],
        ['slot', `${p.city} · ${p.slot}`],
      ],
      chip: 'pending',
      timestamp: event.timestamp,
      slotPayload: null,
    })
  }
}

function handleDecisionEvent(state: NegotiationState, event: AgentStreamEvent): void {
  const d = event.content as ProposalDecision | null | undefined
  if (!d || !d.agent || !d.status) return
  const key = proposalKey(d.agent, d.city, d.date, d.slot)
  const existing = state.events.find((e) => e.id === key)
  if (existing) {
    existing.chip = d.status
    existing.decisionReason = d.reason
  } else {
    pushOrUpdateEvent(state, {
      id: key,
      who: d.agent,
      color: colorFor(d.agent),
      kind: 'agent · propose',
      body: d.activity,
      facts: [['cost', `€${d.estimatedCostPerPerson ?? 0}/pp`]],
      chip: d.status,
      decisionReason: d.reason,
      timestamp: event.timestamp,
    })
  }
  if (d.status === 'rejected') return
  const day = state.slots.find((sd) => sd.city === d.city && sd.date === d.date)
  const slot = day?.slots[d.slot]
  // A slot logistics already reserved for transit is authoritative — mirrors
  // WorkflowEngine.stripBlockedSlotActivities on the backend.
  if (day && slot && slot.status !== 'reserved') {
    slot.status = 'filled'
    slot.name = d.activity
    slot.by = d.agent
    slot.color = colorFor(d.agent)
    slot.cost = d.estimatedCostPerPerson ?? 0
  }
}

// Fallback for when the backend hasn't emitted per-proposal agent.decision
// events for this trip yet — approximates accept/reject from the final
// merged itinerary and fills slots directly from it.
function handleMergeEvent(state: NegotiationState, event: AgentStreamEvent): void {
  const content = event.content as {
    itinerary?: Array<{
      day: number
      activities?: Array<{ ownerAgent?: string; satisfies?: string[]; activity?: string; time?: string; estimatedCostPerPerson?: number }>
    }>
  } | null | undefined

  const wonAgents = new Set<string>()
  for (const dayBlock of content?.itinerary ?? []) {
    const draftDay = state.slots.find((sd) => sd.day === dayBlock.day)
    for (const act of dayBlock.activities ?? []) {
      const owner = act.ownerAgent ?? act.satisfies?.[0]
      if (owner) wonAgents.add(owner)
      const slotKey = act.time as (typeof SLOT_KEYS)[number] | undefined
      if (!draftDay || !slotKey || !SLOT_KEYS.includes(slotKey)) continue
      const slot = draftDay.slots[slotKey]
      if (slot.status !== 'empty' || !owner) continue
      slot.status = 'filled'
      slot.name = act.activity ?? 'Activity'
      slot.by = owner
      slot.color = colorFor(owner)
      slot.cost = act.estimatedCostPerPerson ?? 0
    }
  }

  for (const e of state.events) {
    if (e.chip === 'pending' && e.kind === 'agent · propose') {
      e.chip = wonAgents.has(e.who) ? 'accepted' : 'rejected'
    }
  }

  pushOrUpdateEvent(state, {
    id: `merge-${event.timestamp}`,
    who: 'orchestrator',
    color: 'neutral',
    kind: 'workflow',
    body: 'Itinerary assembled',
    facts: [],
    chip: 'applied',
    timestamp: event.timestamp,
  })
}

/**
 * Mutates `state` in place to reflect one incoming AgentStreamEvent. Never
 * throws — an unrecognised or malformed event is a defensive no-op rather
 * than a crash, since the live stream is not a contract we fully control.
 */
export function reconcile(state: NegotiationState, event: AgentStreamEvent): void {
  try {
    state.session.lastEventAt = Date.now()
    if (state.session.startedAt === null) state.session.startedAt = Date.now()

    if (typeof event.type !== 'string') return

    if (event.type.startsWith('workflow.')) {
      handleWorkflowEvent(state, event)
    } else if (event.type === 'agent.plan') {
      handlePlanEvent(state, event)
    } else if (event.type === 'agent.estimate') {
      handleEstimateEvent(state, event)
    } else if (event.type === 'agent.propose' && event.agent !== 'orchestrator') {
      handleProposeEvent(state, event)
    } else if (event.type === 'agent.decision') {
      handleDecisionEvent(state, event)
    } else if (event.type === 'agent.merge') {
      handleMergeEvent(state, event)
    } else if (event.type === 'negotiation_complete') {
      state.session.status = 'complete'
    }
    // Unrecognised type — intentionally ignored.
  } catch {
    // Malformed event content must never crash the negotiate view.
  }
}

/** Force-resolves any proposal still `pending` — safety net if neither an
 * agent.decision event nor the agent.merge fallback ever resolved it. */
export function sweepPendingEvents(state: NegotiationState): void {
  for (const e of state.events) {
    if (e.chip === 'pending') e.chip = 'rejected'
  }
}

// Counts both agent-filled and logistics-reserved slots — both are
// "resolved", i.e. no longer available for a tourist proposal.
export function filledSlotCount(state: NegotiationState): number {
  return state.slots.reduce(
    (sum, day) => sum + SLOT_KEYS.filter((k) => day.slots[k].status !== 'empty').length,
    0,
  )
}

export function runningTotal(state: NegotiationState): number {
  return state.slots.reduce(
    (sum, day) => sum + SLOT_KEYS.reduce((s, k) => s + (day.slots[k].status === 'filled' ? (day.slots[k].cost ?? 0) : 0), 0),
    0,
  )
}

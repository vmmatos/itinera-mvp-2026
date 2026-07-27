import { defineStore } from 'pinia'
import { ref, computed, watch, type Ref } from 'vue'
import type { NegotiationState } from '~/types/index'
import {
  createInitialNegotiationState,
  reconcile,
  sweepPendingEvents,
  seedLogisticsPlanIfMissing,
  filledSlotCount,
  runningTotal as computeRunningTotal,
  type BackfillProposal,
} from '~/utils/negotiationReducer'

// Grace period after the merge/resolve stage finishes before any proposal
// still stuck at "pending" is force-resolved — avoids an infinite spinner if
// neither an agent.decision event nor the agent.merge fallback resolved it.
const SWEEP_DELAY_MS = 8000
const MERGE_STAGE_INDEX = 3 // MERGE_AND_SCORE — see WORKFLOW_STAGE_ORDER

export const useNegotiationStore = defineStore('negotiation', () => {
  const api = useApi()
  const state = ref<NegotiationState>(createInitialNegotiationState())
  const connected = ref(false)

  let stopEventsWatch: (() => void) | null = null
  let sweepTimer: ReturnType<typeof setTimeout> | null = null
  let processedCount = 0
  // Bumped by reset() (including the one connect() runs first) — lets a
  // still-in-flight hydrateFromProposals() from a superseded connect() detect
  // it's stale and avoid mutating state that's since moved on.
  let connectionEpoch = 0

  const busyCount = computed(() => state.value.agents.filter((a) => a.state !== 'idle').length)
  const filledCount = computed(() => filledSlotCount(state.value))
  const totalSlots = computed(() => state.value.slots.length * 3)
  const runningTotal = computed(() => computeRunningTotal(state.value))

  function applyEvent(evt: Parameters<typeof reconcile>[1]): void {
    reconcile(state.value, evt)
    const mergeStage = state.value.stages[MERGE_STAGE_INDEX]
    if (mergeStage?.status === 'done' && sweepTimer === null) {
      sweepTimer = setTimeout(() => {
        sweepPendingEvents(state.value)
        sweepTimer = null
      }, SWEEP_DELAY_MS)
    }
  }

  // The logistics agent typically publishes agent.plan within tens of ms of
  // trip creation — often before the SSE stream below has even finished its
  // handshake — so this one-shot REST fetch backfills the Draft Itinerary /
  // logistics agent card from what's already persisted, in case the live
  // event was missed. Best-effort: the live SSE stream remains authoritative,
  // and this never throws or blocks connect().
  async function hydrateFromProposals(tripId: string, epoch: number): Promise<void> {
    try {
      const res = await api.get<{ success: boolean; data: BackfillProposal[] }>(`/api/v1/trips/${tripId}/proposals`)
      if (epoch !== connectionEpoch) return // superseded by a newer connect()/reset()
      seedLogisticsPlanIfMissing(state.value, res.data.data)
    } catch {
      // Best-effort only — ignore and rely on the live stream.
    }
  }

  function connect(tripId: Ref<string | null>, budgetTotal = 0): void {
    reset(budgetTotal)
    const epoch = connectionEpoch
    const stream = useAgentStream(tripId)
    processedCount = 0
    stopEventsWatch = watch(
      stream.events,
      (events) => {
        connected.value = stream.connected.value
        const newCount = events.length - processedCount
        if (newCount <= 0) return
        // events is newest-first (prepended) — replay the new batch oldest-first
        const newItems = events.slice(0, newCount).slice().reverse()
        for (const evt of newItems) applyEvent(evt)
        processedCount = events.length
      },
      // sync flush — events must land the instant they arrive, not on the
      // next microtask tick, so the "live" feel and time-based assertions
      // (heartbeat, sweep timer) stay accurate.
      { immediate: true, flush: 'sync' },
    )
    if (tripId.value) void hydrateFromProposals(tripId.value, epoch)
  }

  function reset(budgetTotal = 0): void {
    connectionEpoch += 1
    stopEventsWatch?.()
    stopEventsWatch = null
    if (sweepTimer !== null) {
      clearTimeout(sweepTimer)
      sweepTimer = null
    }
    processedCount = 0
    connected.value = false
    state.value = createInitialNegotiationState(budgetTotal)
  }

  return {
    state,
    connected,
    busyCount,
    filledCount,
    totalSlots,
    runningTotal,
    connect,
    reset,
    applyEvent,
  }
})

<script setup lang="ts">
import { computed, watch, onUnmounted } from 'vue'
import { useNegotiationStore } from '~/stores/negotiation'
import NegotiateTopBar from './NegotiateTopBar.vue'
import StagePipeline from './StagePipeline.vue'
import AgentList from './AgentList.vue'
import DecisionStream from './DecisionStream.vue'
import DraftItinerary from './DraftItinerary.vue'

const props = defineProps<{
  tripId: string | null
  budgetTotal: number
  negotiationStatus: string
  rejectionReason: string
}>()

const emit = defineEmits<{
  cancel: []
  adjust: []
}>()

const store = useNegotiationStore()
const tripIdRef = computed(() => props.tripId)

watch(
  tripIdRef,
  (id) => {
    if (id) store.connect(tripIdRef, props.budgetTotal)
  },
  { immediate: true },
)

onUnmounted(() => store.reset())
</script>

<template>
  <div v-if="negotiationStatus === 'cancelled'" style="padding:var(--s-6);background:rgba(255,93,93,0.06);border:1px solid rgba(255,93,93,0.24);border-radius:var(--r-2);text-align:center;margin:var(--s-6)">
    <p style="color:var(--red);font-size:var(--t-15);margin:0 0 var(--s-3)">Negotiation failed</p>
    <p class="helper" style="margin:0 0 var(--s-4)">The agents could not agree on an itinerary. Please try again.</p>
    <button class="btn" @click="emit('cancel')">Back to dashboard</button>
  </div>

  <div v-else-if="negotiationStatus === 'rejected'" style="padding:var(--s-6);background:rgba(245,158,11,0.06);border:1px solid rgba(245,158,11,0.28);border-radius:var(--r-2);text-align:center;margin:var(--s-6)">
    <p style="color:var(--amber, #f59e0b);font-size:var(--t-15);margin:0 0 var(--s-3)">This trip needs reformulating</p>
    <p class="helper" style="margin:0 0 var(--s-4);text-transform:none;letter-spacing:0">{{ rejectionReason }}</p>
    <button class="btn" @click="emit('adjust')">Adjust trip &amp; budget</button>
  </div>

  <div v-else style="display:flex;flex-direction:column;height:100%;min-height:0">
    <div style="display:flex;justify-content:flex-end;padding:8px 20px;border-bottom:var(--hair-soft, var(--hair))">
      <NegotiateTopBar
        :status="store.state.session.status"
        :started-at="store.state.session.startedAt"
        :last-event-at="store.state.session.lastEventAt"
      />
    </div>

    <StagePipeline :stages="store.state.stages" />

    <div class="max-[1180px]:grid-cols-[260px_minmax(0,1fr)]" style="display:grid;grid-template-columns:300px minmax(0,1fr) 340px;flex:1;min-height:0">
      <AgentList :agents="store.state.agents" />
      <DecisionStream :events="store.state.events" :session-status="store.state.session.status" />
      <DraftItinerary
        :days="store.state.slots"
        :budget-total="store.state.budgetTotal"
        :running-total="store.runningTotal"
        :filled-count="store.filledCount"
        :total-slots="store.totalSlots"
      />
    </div>
  </div>
</template>

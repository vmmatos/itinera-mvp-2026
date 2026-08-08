<script setup lang="ts">
import { computed, ref, watch, onUnmounted } from 'vue'
import { useNegotiationStore } from '~/stores/negotiation'
import NegotiateTopBar from './NegotiateTopBar.vue'
import StagePipeline from './StagePipeline.vue'
import AgentList from './AgentList.vue'
import DecisionStream from './DecisionStream.vue'
import DraftItinerary from './DraftItinerary.vue'

const { t } = useI18n()

type MobilePanel = 'agents' | 'activity' | 'itinerary'
const activeMobilePanel = ref<MobilePanel>('activity')

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
    <p style="color:var(--red);font-size:var(--t-15);margin:0 0 var(--s-3)">{{ t('trip.negotiate.stepV2.negotiationFailed') }}</p>
    <p class="helper" style="margin:0 0 var(--s-4);text-transform:none;letter-spacing:0">{{ rejectionReason || t('trip.negotiate.stepV2.negotiationFailedBody') }}</p>
    <button class="btn" @click="emit('cancel')">{{ t('trip.negotiate.stepV2.backToDashboard') }}</button>
  </div>

  <div v-else-if="negotiationStatus === 'rejected'" style="padding:var(--s-6);background:rgba(245,158,11,0.06);border:1px solid rgba(245,158,11,0.28);border-radius:var(--r-2);text-align:center;margin:var(--s-6)">
    <p style="color:var(--amber, #f59e0b);font-size:var(--t-15);margin:0 0 var(--s-3)">{{ t('trip.negotiate.stepV2.needsReformulating') }}</p>
    <p class="helper" style="margin:0 0 var(--s-4);text-transform:none;letter-spacing:0">{{ rejectionReason }}</p>
    <button class="btn" @click="emit('adjust')">{{ t('trip.negotiate.stepV2.adjustTripAndBudget') }}</button>
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

    <div class="mobile-tabs">
      <button
        data-testid="mobile-panel-tab-agents"
        :class="['t', { on: activeMobilePanel === 'agents' }]"
        type="button"
        @click="activeMobilePanel = 'agents'"
      >{{ t('trip.negotiate.stepV2.panelAgents') }}</button>
      <button
        data-testid="mobile-panel-tab-activity"
        :class="['t', { on: activeMobilePanel === 'activity' }]"
        type="button"
        @click="activeMobilePanel = 'activity'"
      >{{ t('trip.negotiate.stepV2.panelActivity') }}</button>
      <button
        data-testid="mobile-panel-tab-itinerary"
        :class="['t', { on: activeMobilePanel === 'itinerary' }]"
        type="button"
        @click="activeMobilePanel = 'itinerary'"
      >{{ t('trip.negotiate.stepV2.panelItinerary') }}</button>
    </div>

    <div class="negotiate-body">
      <AgentList :agents="store.state.agents" :class="{ 'panel-hidden': activeMobilePanel !== 'agents' }" />
      <DecisionStream :events="store.state.events" :session-status="store.state.session.status" :class="{ 'panel-hidden': activeMobilePanel !== 'activity' }" />
      <DraftItinerary
        :days="store.state.slots"
        :budget-total="store.state.budgetTotal"
        :running-total="store.runningTotal"
        :filled-count="store.filledCount"
        :total-slots="store.totalSlots"
        :class="{ 'panel-hidden': activeMobilePanel !== 'itinerary' }"
      />
    </div>
  </div>
</template>

<style scoped>
.negotiate-body {
  display: grid;
  grid-template-columns: 300px minmax(0, 1fr) 340px;
  flex: 1;
  min-height: 0;
}

.mobile-tabs {
  display: none;
}

@media (max-width: 1180px) {
  .negotiate-body {
    display: flex;
    flex-direction: column;
  }
  .negotiate-body > :deep(*) {
    flex: 1;
    min-height: 0;
  }
}

@media (max-width: 820px) {
  .mobile-tabs {
    display: flex;
    border-bottom: var(--hair);
    padding: 0 var(--s-5, 20px);
    font-family: var(--mono);
    font-size: var(--t-12, 12px);
    text-transform: uppercase;
    letter-spacing: .08em;
    flex-shrink: 0;
  }
  .mobile-tabs .t {
    padding: var(--s-3, 10px) var(--s-4, 14px);
    border: none;
    border-bottom: 2px solid transparent;
    background: none;
    color: var(--fg-3);
    cursor: pointer;
    font-family: var(--mono);
    font-size: var(--t-12, 12px);
    text-transform: uppercase;
    letter-spacing: .08em;
    flex: 1;
  }
  .mobile-tabs .t.on {
    color: var(--fg-0);
    border-bottom-color: var(--green);
  }
  .negotiate-body > :deep(.panel-hidden) {
    display: none;
  }
}
</style>

<script setup lang="ts">
import type { BudgetBreakdown, TravellerScore } from '~/types/index'
import type { DayVM } from '~/utils/itineraryViewModel'
import TripItineraryPriceSummary from './PriceSummary.vue'
import TripItineraryCostByDayChart from './CostByDayChart.vue'
import TripItineraryNegotiationQuality from './NegotiationQuality.vue'
import TripItineraryTravellerSatisfaction from './TravellerSatisfaction.vue'
import TripItineraryAgentChips from './AgentChips.vue'
import TripItinerarySummaryFooter from './SummaryFooter.vue'

const { t } = useI18n()

const props = defineProps<{
  open: boolean
  budgetBreakdown: BudgetBreakdown | null
  priceMode: 'pp' | 'total'
  travellers: number
  currencySymbol: string
  days: DayVM[]
  selectedDay: number
  fairnessScore: number | null
  satisfactionScore: number | null
  travellerScores: TravellerScore[]
  constraintsPassed: boolean | null
  timingConflicts: number
  rounds: number | null
  agentNames: string[]
  exportLoading: boolean
  shareLoading: boolean
  shareCopied: boolean
  exportError: string | null
  shareError: string | null
}>()

defineEmits<{ select: [index: number]; export: []; share: [] }>()
</script>

<template>
  <aside class="summary" :class="{ show: props.open }" data-testid="summary-panel">
    <TripItineraryPriceSummary
      :budget-breakdown="props.budgetBreakdown"
      :price-mode="props.priceMode"
      :travellers="props.travellers"
      :currency-symbol="props.currencySymbol"
    />

    <div class="sum-sec">
      <h4>{{ t('trip.itinerary.summaryPanel.costByDay') }} <span class="hint">{{ t('trip.itinerary.summaryPanel.clickToJump') }}</span></h4>
      <TripItineraryCostByDayChart :days="props.days" :selected-day="props.selectedDay" @select="$emit('select', $event)" />
    </div>

    <TripItineraryNegotiationQuality
      :fairness-score="props.fairnessScore"
      :satisfaction-score="props.satisfactionScore"
      :constraints-passed="props.constraintsPassed"
      :timing-conflicts="props.timingConflicts"
      :rounds="props.rounds"
    />

    <TripItineraryTravellerSatisfaction :scores="props.travellerScores" />

    <TripItineraryAgentChips :agent-names="props.agentNames" />

    <TripItinerarySummaryFooter
      :export-loading="props.exportLoading"
      :share-loading="props.shareLoading"
      :share-copied="props.shareCopied"
      :export-error="props.exportError"
      :share-error="props.shareError"
      @export="$emit('export')"
      @share="$emit('share')"
    />
  </aside>
</template>

<style scoped>
.summary { min-width: 0; min-height: 0; overflow-y: auto; background: var(--bg-1); }
.sum-sec { padding: var(--s-5) var(--s-5); border-bottom: var(--hair); }
.sum-sec h4 { margin: 0 0 var(--s-4); font-family: var(--mono); font-size: var(--t-12); color: var(--fg-3); text-transform: uppercase; letter-spacing: .1em; font-weight: 500; display: flex; justify-content: space-between; align-items: center; }
.hint { font-family: var(--mono); font-size: 10px; color: var(--fg-4); }
@media (max-width: 1080px) {
  .summary { display: none; }
  .summary.show { display: block; position: fixed; top: 0; right: 0; bottom: 0; width: 400px; max-width: 90vw; z-index: 60; box-shadow: -20px 0 40px rgba(0,0,0,.5); border-left: var(--hair); }
}
</style>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import type { BudgetBreakdown, ItineraryDay, SatisfactionScore } from '~/types/index'
import {
  groupIntoSegments,
  buildDayViewModels,
  parseWeatherAssessment,
  currencySymbolFor,
  formatDateRange,
  type AccommodationBlock,
} from '~/utils/itineraryViewModel'
import TripItineraryReviewHeader from './ReviewHeader.vue'
import TripItineraryTimelineRail from './TimelineRail.vue'
import TripItineraryDayPanel from './DayPanel.vue'
import TripItinerarySummaryPanel from './SummaryPanel.vue'

interface ValidatorSummary {
  fairnessScore: number | null
  overallScore: number | null
  constraintsPassed: boolean | null
  rounds: number | null
}

const props = defineProps<{
  tripName: string
  region: string
  startDate: string
  endDate: string
  dateMode: 'fixed' | 'flexible'
  preferredMonth: string
  travellers: number
  timelineDays: ItineraryDay[]
  budgetBreakdown: BudgetBreakdown | null
  accommodation: AccommodationBlock[]
  weatherAssessment: Record<string, unknown> | null
  showWeather: boolean
  validatorSummary: ValidatorSummary | null
  travellerScores: SatisfactionScore[]
  agentNames: string[]
  exportLoading: boolean
  shareLoading: boolean
  shareCopied: boolean
  exportError: string | null
  shareError: string | null
}>()

const emit = defineEmits<{
  accept: []
  reject: []
  refine: []
  share: []
  export: []
}>()

const selectedDay = ref(0)
const priceMode = ref<'pp' | 'total'>('pp')
const summaryOpen = ref(false)

const currencySymbol = computed(() => currencySymbolFor(props.budgetBreakdown?.currency))

const parsedWeather = computed(() => (props.showWeather ? parseWeatherAssessment(props.weatherAssessment) : null))

const dayVMs = computed(() =>
  buildDayViewModels(props.timelineDays, parsedWeather.value, props.accommodation, props.budgetBreakdown),
)

const segments = computed(() => groupIntoSegments(props.timelineDays))

const currentDay = computed(() => dayVMs.value[selectedDay.value] ?? null)

const title = computed(() => props.tripName || props.region || 'Trip')
const meta = computed(() => {
  const parts = [`${dayVMs.value.length} days`, `${props.travellers} travellers`]
  const dateRange = props.dateMode === 'fixed' ? formatDateRange(props.startDate, props.endDate) : props.preferredMonth
  if (dateRange) parts.push(dateRange)
  return parts.join(' · ')
})

const satisfactionScore = computed(() => {
  const scores = props.travellerScores
  if (scores.length > 0) {
    const avg = scores.reduce((sum, s) => sum + s.postScore, 0) / scores.length
    return Math.round(avg * 100)
  }
  return props.validatorSummary?.overallScore ?? null
})

const timingConflicts = computed(() => parsedWeather.value?.timingIssues.length ?? 0)

function select(index: number): void {
  selectedDay.value = Math.max(0, Math.min(dayVMs.value.length - 1, index))
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'ArrowRight') select(selectedDay.value + 1)
  if (e.key === 'ArrowLeft') select(selectedDay.value - 1)
}

onMounted(() => document.addEventListener('keydown', onKeydown))
onUnmounted(() => document.removeEventListener('keydown', onKeydown))

// Clamp selection if the itinerary shrinks/changes underneath us (e.g. a
// re-run produces fewer days).
watch(() => dayVMs.value.length, (len) => {
  if (selectedDay.value > len - 1) selectedDay.value = Math.max(0, len - 1)
})
</script>

<template>
  <div class="itin-step">
    <TripItineraryReviewHeader
      :title="title"
      :meta="meta"
      :price-mode="priceMode"
      @update:price-mode="priceMode = $event"
      @refine="emit('refine')"
      @accept="emit('accept')"
      @reject="emit('reject')"
      @toggle-summary="summaryOpen = !summaryOpen"
    />

    <TripItineraryTimelineRail
      v-if="dayVMs.length > 0"
      :segments="segments"
      :days="dayVMs"
      :selected-day="selectedDay"
      :price-mode="priceMode"
      :travellers="props.travellers"
      :currency-symbol="currencySymbol"
      :show-weather="props.showWeather"
      @select="select"
    />

    <div v-if="currentDay" class="content">
      <TripItineraryDayPanel
        :day="currentDay"
        :day-index="selectedDay"
        :total-days="dayVMs.length"
        :price-mode="priceMode"
        :travellers="props.travellers"
        :currency-symbol="currencySymbol"
        @prev="select(selectedDay - 1)"
        @next="select(selectedDay + 1)"
      />

      <TripItinerarySummaryPanel
        :open="summaryOpen"
        :budget-breakdown="props.budgetBreakdown"
        :price-mode="priceMode"
        :travellers="props.travellers"
        :currency-symbol="currencySymbol"
        :days="dayVMs"
        :selected-day="selectedDay"
        :fairness-score="props.validatorSummary?.fairnessScore ?? null"
        :satisfaction-score="satisfactionScore"
        :constraints-passed="props.validatorSummary?.constraintsPassed ?? null"
        :timing-conflicts="timingConflicts"
        :rounds="props.validatorSummary?.rounds ?? null"
        :agent-names="props.agentNames"
        :export-loading="props.exportLoading"
        :share-loading="props.shareLoading"
        :share-copied="props.shareCopied"
        :export-error="props.exportError"
        :share-error="props.shareError"
        @select="select"
        @export="emit('export')"
        @share="emit('share')"
      />
    </div>

    <p v-else class="empty" data-testid="itinerary-empty">
      The itinerary is still being finalized — check back in a moment.
    </p>
  </div>
</template>

<style scoped>
.itin-step { flex: 1; min-height: 0; display: flex; flex-direction: column; height: 100%; overflow: hidden; }
.content { display: grid; grid-template-columns: minmax(0, 1fr) 400px; flex: 1; min-height: 0; }
.empty { padding: var(--s-8); text-align: center; color: var(--fg-3); font-family: var(--mono); font-size: var(--t-13); }
@media (max-width: 1080px) {
  .content { grid-template-columns: 1fr; }
}
</style>

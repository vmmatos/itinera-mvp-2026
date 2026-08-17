<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { driver } from 'driver.js'
import 'driver.js/dist/driver.css'
import type { BudgetBreakdown, DateInput, ItineraryDay, TravellerScore } from '~/types/index'
import type { RestrictionWarning, SpecialEvent } from '~/utils/itinerary'
import {
  groupIntoSegments,
  buildDayViewModels,
  parseWeatherAssessment,
  resolveWeatherGate,
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

const { t } = useI18n()
const walkthroughStore = useWalkthroughStore()

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
  dateInput: DateInput | null
  restrictionWarnings?: RestrictionWarning[]
  specialEvents?: SpecialEvent[]
  validatorSummary: ValidatorSummary | null
  travellerScores: TravellerScore[]
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

// Parsed unconditionally: timingIssues come from the TimingValidator, not from
// the weather API, and must survive the weather gate (see timingConflicts).
const parsedWeather = computed(() => parseWeatherAssessment(props.weatherAssessment))
const weatherGate = computed(() => resolveWeatherGate(props.dateInput, parsedWeather.value))
const dayWeather = computed(() => (weatherGate.value.show ? parsedWeather.value : null))

const dayVMs = computed(() =>
  buildDayViewModels(props.timelineDays, dayWeather.value, props.accommodation, props.budgetBreakdown),
)

const segments = computed(() => groupIntoSegments(props.timelineDays))

const currentDay = computed(() => dayVMs.value[selectedDay.value] ?? null)

const title = computed(() => props.tripName || props.region || t('trip.itinerary.itineraryStep.tripFallback'))
const meta = computed(() => {
  const parts = [
    `${dayVMs.value.length} ${t('trip.itinerary.itineraryStep.days')}`,
    `${props.travellers} ${t('trip.form.travellersPlural')}`,
  ]
  const dateRange = props.dateMode === 'fixed' ? formatDateRange(props.startDate, props.endDate) : props.preferredMonth
  if (dateRange) parts.push(dateRange)
  return parts.join(' · ')
})

// Group-level number. The validator's own mean is authoritative; averaging the
// rows is only a fallback for a proposal that carried scores but no overall.
const satisfactionScore = computed(() => {
  if (props.validatorSummary?.overallScore !== null && props.validatorSummary?.overallScore !== undefined) {
    return props.validatorSummary.overallScore
  }
  const scores = props.travellerScores
  if (scores.length === 0) return null
  return Math.round(scores.reduce((sum, s) => sum + s.score, 0) / scores.length)
})

const timingConflicts = computed(() => parsedWeather.value?.timingIssues.length ?? 0)

function select(index: number): void {
  selectedDay.value = Math.max(0, Math.min(dayVMs.value.length - 1, index))
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'ArrowRight') select(selectedDay.value + 1)
  if (e.key === 'ArrowLeft') select(selectedDay.value - 1)
}

let explainerDriver: ReturnType<typeof driver> | null = null

onMounted(() => {
  document.addEventListener('keydown', onKeydown)
  if (walkthroughStore.active) {
    explainerDriver = driver({
      allowClose: false,
      onDestroyed: () => { void walkthroughStore.complete() },
    })
    explainerDriver.setSteps([{
      element: '[data-testid="itinerary-review-header"]',
      popover: {
        title: t('walkthrough.step4.title'),
        description: t('walkthrough.step4.description'),
        side: 'bottom',
        align: 'start',
      },
    }])
    explainerDriver.drive()
  }
})
onUnmounted(() => {
  document.removeEventListener('keydown', onKeydown)
  // Leaving step 4 by any means (Accept/Reject/Cancel/navigating away) must
  // still mark the walkthrough seen — not just dismissing the driver popover
  // itself. destroy() re-fires onDestroyed, so this reuses the same path.
  explainerDriver?.destroy()
})

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
      :show-weather="weatherGate.show"
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
        :restriction-warnings="props.restrictionWarnings"
        :special-events="props.specialEvents"
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
        :traveller-scores="props.travellerScores"
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
      {{ t('trip.itinerary.itineraryStep.stillFinalizing') }}
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

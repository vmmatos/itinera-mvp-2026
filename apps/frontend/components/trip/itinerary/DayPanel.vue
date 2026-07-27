<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import type { DayVM, Phase } from '~/utils/itineraryV2'
import TripItineraryDaySlot from './DaySlot.vue'

const props = defineProps<{
  day: DayVM
  dayIndex: number
  totalDays: number
  priceMode: 'pp' | 'total'
  travellers: number
  currencySymbol: string
}>()

defineEmits<{ prev: []; next: [] }>()

const PHASES: Phase[] = ['morning', 'afternoon', 'evening']
const bodyEl = ref<HTMLElement | null>(null)

watch(() => props.day.index, () => {
  if (bodyEl.value) bodyEl.value.scrollTop = 0
})

const riskLabel = computed(() => {
  if (!props.day.weather) return null
  if (props.day.weather.risk === 'heat') return '▲ heat advisory'
  if (props.day.weather.risk === 'low') return '✓ low risk'
  return null
})
</script>

<template>
  <div class="day-panel">
    <div class="dp-head">
      <div class="nav">
        <button class="arrow" :disabled="props.dayIndex === 0" data-testid="day-prev" @click="$emit('prev')">‹</button>
        <button class="arrow" :disabled="props.dayIndex === props.totalDays - 1" data-testid="day-next" @click="$emit('next')">›</button>
        <div class="title">
          <div class="d">day {{ props.day.day }} · {{ props.day.dateLabel.toLowerCase() }}</div>
          <h2 data-testid="day-city">{{ props.day.city }}</h2>
        </div>
      </div>
      <div v-if="props.day.weather" class="wx-banner" data-testid="weather-banner">
        <span class="big">{{ props.day.weather.icon }}</span>
        <div class="col">
          <span class="cond">{{ props.day.weather.condition ?? 'Forecast' }}</span>
          <span class="tmp">
            <template v-if="props.day.weather.tempHigh !== undefined">
              {{ props.day.weather.tempHigh }}° <small>/ {{ props.day.weather.tempLow }}°</small>
              <template v-if="props.day.weather.precipitationProbability !== undefined"> · {{ props.day.weather.precipitationProbability }}% rain</template>
            </template>
            <template v-else>no live forecast</template>
          </span>
        </div>
        <span v-if="riskLabel" class="risk" :class="props.day.weather.risk" data-testid="risk-chip">{{ riskLabel }}</span>
      </div>
    </div>

    <div ref="bodyEl" class="dp-body">
      <div v-if="props.day.weather?.risk === 'heat'" class="wx-advisory" data-testid="heat-advisory">
        ▲ {{ props.day.weather.tempHigh }}°C peak — plan indoor/shaded activities and keep midday light
      </div>

      <template v-for="phase in PHASES" :key="phase">
        <TripItineraryDaySlot
          v-for="(slot, i) in props.day.slots[phase]"
          :key="`${phase}-${i}`"
          :slot="slot"
          :phase="phase"
          :price-mode="props.priceMode"
          :travellers="props.travellers"
          :currency-symbol="props.currencySymbol"
        />
      </template>

      <p v-if="!PHASES.some((p) => props.day.slots[p].length > 0)" class="empty" data-testid="day-empty">
        No activities planned for this day yet.
      </p>
    </div>
  </div>
</template>

<style scoped>
.day-panel { min-width: 0; min-height: 0; display: flex; flex-direction: column; border-right: var(--hair); }
.dp-head { display: flex; align-items: stretch; justify-content: space-between; padding: var(--s-4) var(--s-6); border-bottom: var(--hair); flex-shrink: 0; gap: var(--s-4); flex-wrap: wrap; }
.nav { display: flex; align-items: center; gap: var(--s-3); min-width: 0; }
.arrow { width: 32px; height: 32px; border: var(--hair); background: var(--bg-2); display: grid; place-items: center; font-family: var(--mono); color: var(--fg-2); flex-shrink: 0; border-radius: var(--r-1); cursor: pointer; }
.arrow:hover:not(:disabled) { border-color: var(--line-3); color: var(--fg-0); }
.arrow:disabled { opacity: .3; cursor: default; }
.title { min-width: 0; }
.title .d { font-family: var(--mono); font-size: var(--t-12); color: var(--fg-3); text-transform: uppercase; letter-spacing: .08em; }
.title h2 { margin: 2px 0 0; font-size: var(--t-22); font-weight: 500; letter-spacing: -0.015em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wx-banner { display: flex; align-items: center; gap: var(--s-4); padding: var(--s-2) var(--s-4); border: var(--hair); background: var(--bg-2); flex-shrink: 0; border-radius: var(--r-2); }
.wx-banner .big { font-size: 26px; line-height: 1; }
.wx-banner .col { display: flex; flex-direction: column; gap: 1px; }
.wx-banner .cond { font-family: var(--mono); font-size: var(--t-12); color: var(--fg-1); text-transform: uppercase; letter-spacing: .06em; }
.wx-banner .tmp { font-family: var(--mono); font-size: var(--t-14); color: var(--fg-0); }
.wx-banner .tmp small { color: var(--fg-3); }
.wx-banner .risk { font-family: var(--mono); font-size: var(--t-12); text-transform: uppercase; letter-spacing: .06em; padding: 2px 7px; border: 1px solid var(--line-2); color: var(--fg-3); }
.wx-banner .risk.heat { color: var(--amber); border-color: var(--amber-line); background: var(--amber-bg); }
.wx-banner .risk.low { color: var(--green); border-color: var(--green-line); background: var(--green-bg); }
.dp-body { flex: 1; overflow-y: auto; padding: var(--s-2) var(--s-6) var(--s-8); }
.wx-advisory { display: flex; align-items: center; gap: var(--s-2); margin: var(--s-4) 0 4px; padding: 9px var(--s-3); border: 1px solid var(--amber-line); background: var(--amber-bg); font-family: var(--mono); font-size: var(--t-12); color: var(--amber); }
.empty { color: var(--fg-3); font-family: var(--mono); font-size: var(--t-13); padding: var(--s-6) 0; }
@media (max-width: 640px) {
  .dp-head { flex-wrap: wrap; }
}
</style>

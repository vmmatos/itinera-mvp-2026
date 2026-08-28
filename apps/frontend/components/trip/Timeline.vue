<script setup lang="ts">
import { computed } from 'vue'
import type { ActivityCardProps } from '~/components/trip/ActivityCard.vue'
import type { WeatherAssessment } from '~/types/index'
import type { RestrictionWarning, SpecialEvent } from '~/utils/itinerary'
import { formatDayHeader, warningsForDay, eventsForDay, formatEventDateTime } from '~/utils/itinerary'
import { buildDayWeather, type DayWeatherVM } from '~/utils/itineraryViewModel'

export interface TimelineActivity extends ActivityCardProps {
  time?:      string
  satisfies?: string[]
}

export interface TimelineDay {
  day:        number
  date?:      string
  city?:      string
  country?:   string
  activities: TimelineActivity[]
  meals?:     Array<{ type: string; name: string; location?: string; rating?: number }>
}

const props = defineProps<{
  days:                 TimelineDay[]
  isDebug?:             boolean
  currencySymbol?:      string
  restrictionWarnings?: RestrictionWarning[]
  specialEvents?:       SpecialEvent[]
  // Already gated by the caller (resolveWeatherGate): null means render no
  // weather at all — flexible dates, or no live forecast for this trip.
  weather?:             WeatherAssessment | null
}>()

const { t } = useI18n()

// Precomputed so the template does not rebuild a VM per day on every render.
// Days with no real forecast (beyond the 5-day horizon) are simply absent.
const weatherByDay = computed<Record<number, DayWeatherVM>>(() => {
  const out: Record<number, DayWeatherVM> = {}
  for (const day of props.days) {
    const vm = buildDayWeather(props.weather ?? null, day.day)
    if (vm) out[day.day] = vm
  }
  return out
})

type TimeSlot = 'morning' | 'afternoon' | 'evening' | 'unscheduled'

const TIME_SLOT_LABELS: Record<TimeSlot, string> = {
  morning:     '🌅 Morning',
  afternoon:   '☀️ Afternoon',
  evening:     '🌙 Evening',
  unscheduled: '📍 Activities',
}

const TIME_SLOT_ORDER: TimeSlot[] = ['morning', 'afternoon', 'evening', 'unscheduled']

function getTimeSlot(time?: string): TimeSlot {
  if (!time) return 'unscheduled'
  const t = time.toLowerCase()
  if (t.includes('morn'))                    return 'morning'
  if (t.includes('after') || t.includes('noon')) return 'afternoon'
  if (t.includes('even') || t.includes('night')) return 'evening'
  const hourMatch = t.match(/^(\d{1,2})[:h]/)
  if (hourMatch) {
    const h = parseInt(hourMatch[1]!, 10)
    if (h >= 6  && h < 12) return 'morning'
    if (h >= 12 && h < 18) return 'afternoon'
    if (h >= 18)            return 'evening'
    return 'morning' // 00:00–05:59 early departures belong in morning
  }
  return 'unscheduled'
}

function activitiesForSlot(activities: TimelineActivity[], slot: TimeSlot): TimelineActivity[] {
  return activities.filter((a) => getTimeSlot(a.time) === slot)
}
</script>

<template>
  <div class="tl-root">
    <div
      v-for="day in days"
      :key="day.day"
      class="tl-day"
    >
      <!-- Day header -->
      <div class="tl-day-head">
        <span class="tl-day-badge">{{ formatDayHeader(day) }}</span>
        <span v-if="day.date" class="tl-day-date">{{ day.date }}</span>
        <span v-if="weatherByDay[day.day]" class="tl-day-wx" data-testid="timeline-day-weather">
          {{ weatherByDay[day.day]?.icon }}
          {{ weatherByDay[day.day]?.tempHigh }}° <small>/ {{ weatherByDay[day.day]?.tempLow }}°</small>
          <template v-if="weatherByDay[day.day]?.precipitationProbability !== undefined">
            · {{ weatherByDay[day.day]?.precipitationProbability }}{{ t('trip.itinerary.dayPanel.rainSuffix') }}
          </template>
        </span>
      </div>

      <!-- Restriction warnings (public holidays, closure rules, opening hours) -->
      <div
        v-if="warningsForDay(props.restrictionWarnings, day.day).length > 0"
        class="tl-restrictions"
      >
        <p
          v-for="(w, wi) in warningsForDay(props.restrictionWarnings, day.day)"
          :key="wi"
          class="tl-restriction-item"
        >{{ w.message }}</p>
      </div>

      <!-- Special events (festivals, concerts, sports, etc — Ticketmaster) -->
      <div
        v-if="eventsForDay(props.specialEvents, day.day).length > 0"
        class="tl-events"
      >
        <a
          v-for="e in eventsForDay(props.specialEvents, day.day)"
          :key="e.id"
          class="tl-event-item"
          :href="e.url"
          target="_blank"
          rel="noopener noreferrer"
        >
          {{ e.name }} · {{ formatEventDateTime(e) }} · {{ e.category }}<template v-if="e.venueName"> · {{ e.venueName }}</template>
          <span v-if="e.matchesMustHave" class="tl-event-badge">match</span>
        </a>
      </div>

      <!-- Activities grouped by time slot -->
      <div class="tl-body">
        <div v-if="day.activities.length === 0" class="tl-empty">No activities.</div>

        <template v-else>
          <template v-for="slot in TIME_SLOT_ORDER" :key="slot">
            <template v-if="activitiesForSlot(day.activities, slot).length > 0">
              <div class="tl-slot-head">
                <span class="tl-slot-label">{{ TIME_SLOT_LABELS[slot] }}</span>
                <div class="tl-slot-rule" />
              </div>
              <TripActivityCard
                v-for="(act, i) in activitiesForSlot(day.activities, slot)"
                :key="i"
                :activity="act"
                :is-debug="isDebug"
                :currency-symbol="currencySymbol"
              />
            </template>
          </template>
        </template>

        <!-- Meals -->
        <div v-if="day.meals && day.meals.length > 0" class="tl-meals">
          <span
            v-for="m in day.meals"
            :key="`${m.type}-${m.name}`"
            class="chip on"
            style="font-size:var(--t-12)"
          >
            {{ m.type }}: {{ m.name }}<template v-if="m.location"> · {{ m.location }}</template><template v-if="typeof m.rating === 'number'"> ★{{ m.rating.toFixed(1) }}</template>
          </span>
        </div>
      </div>

    </div>
  </div>
</template>

<style scoped>
.tl-root {
  display: flex;
  flex-direction: column;
  gap: var(--s-3);
}

.tl-day {
  border: var(--hair);
  border-radius: var(--r-2);
  background: var(--bg-1);
  overflow: hidden;
}

.tl-day-head {
  padding: var(--s-3) var(--s-4);
  border-bottom: var(--hair);
  display: flex;
  align-items: center;
  gap: var(--s-3);
  background: var(--bg-2);
}

.tl-day-badge {
  font-family: var(--mono);
  font-size: var(--t-12);
  color: var(--green);
  font-weight: 600;
  background: var(--green-bg);
  border: 1px solid var(--green-line);
  padding: 2px 8px;
  border-radius: var(--r-1);
}

.tl-day-date {
  font-family: var(--mono);
  font-size: var(--t-12);
  color: var(--fg-3);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.tl-day-wx {
  font-family: var(--mono);
  font-size: var(--t-12);
  color: var(--fg-3);
}

.tl-day-wx small {
  color: var(--fg-4);
}

.tl-body {
  padding: var(--s-2) var(--s-4) var(--s-3);
}

.tl-empty {
  font-family: var(--mono);
  font-size: var(--t-12);
  color: var(--fg-4);
  padding: var(--s-2) 0;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.tl-slot-head {
  display: flex;
  align-items: center;
  gap: var(--s-2);
  padding: var(--s-2) 0 4px;
  margin-top: var(--s-3);
}

.tl-slot-label {
  font-family: var(--mono);
  font-size: 10px;
  color: var(--fg-3);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  white-space: nowrap;
}

.tl-slot-rule {
  flex: 1;
  height: 1px;
  background: rgba(255, 255, 255, 0.06);
}

.tl-meals {
  margin-top: var(--s-3);
  display: flex;
  gap: var(--s-2);
  flex-wrap: wrap;
  padding-top: var(--s-2);
  border-top: 1px solid rgba(255, 255, 255, 0.04);
}

.tl-restrictions {
  background: var(--amber-bg);
  border-top: 1px solid var(--amber-line);
  padding: var(--s-2) var(--s-4);
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.tl-restriction-item {
  font-family: var(--mono);
  font-size: var(--t-12);
  color: var(--amber);
  margin: 0;
  line-height: 1.5;
}

.tl-events {
  background: var(--blue-bg);
  border-top: 1px solid var(--blue-line);
  padding: var(--s-2) var(--s-4);
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.tl-event-item {
  font-family: var(--mono);
  font-size: var(--t-12);
  color: var(--fg-1);
  text-decoration: none;
  line-height: 1.5;
}

.tl-event-badge {
  margin-left: 6px;
  color: var(--green);
  border: 1px solid var(--green-line);
  background: var(--green-bg);
  padding: 0 5px;
  border-radius: var(--r-1);
  text-transform: uppercase;
  letter-spacing: .04em;
}

</style>

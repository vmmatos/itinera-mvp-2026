<script setup lang="ts">
import type { ActivityCardProps } from '~/components/trip/ActivityCard.vue'
import { formatDayHeader, formatTransition } from '~/utils/itinerary'

export interface TimelineActivity extends ActivityCardProps {
  time?:      string
  satisfies?: string[]
}

export interface TimelineCityTransition {
  to:         string
  travelTime: string
}

export interface TimelineDay {
  day:             number
  date?:           string
  city?:           string
  country?:        string
  cityTransition?: TimelineCityTransition
  activities:      TimelineActivity[]
  meals?:          Array<{ type: string; name: string }>
}

interface RestrictionWarning {
  day:          number
  activityName: string
  warningType:  string
  message:      string
}

const props = defineProps<{
  days:                 TimelineDay[]
  isDebug?:             boolean
  currencySymbol?:      string
  restrictionWarnings?: RestrictionWarning[]
}>()

function warningsForDay(dayNum: number): RestrictionWarning[] {
  return (props.restrictionWarnings ?? []).filter((w) => w.day === dayNum)
}

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
    if (h >= 18 || h < 6)  return 'evening'
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
      </div>

      <!-- Restriction warnings (public holidays, closure rules, opening hours) -->
      <div
        v-if="warningsForDay(day.day).length > 0"
        class="tl-restrictions"
      >
        <p
          v-for="(w, wi) in warningsForDay(day.day)"
          :key="wi"
          class="tl-restriction-item"
        >{{ w.message }}</p>
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
          <span v-for="m in day.meals" :key="m.type" class="chip on" style="font-size:var(--t-12)">
            {{ m.type }}: {{ m.name }}
          </span>
        </div>
      </div>

      <!-- City transition -->
      <div v-if="day.cityTransition" class="tl-transition">
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M8 1.5C5.51 1.5 3.5 3.51 3.5 6c0 3.75 4.5 8.5 4.5 8.5s4.5-4.75 4.5-8.5c0-2.49-2.01-4.5-4.5-4.5zm0 6a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z" fill="currentColor"/>
        </svg>
        <span>{{ formatTransition(day.cityTransition) }}</span>
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

.tl-transition {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: var(--s-2) var(--s-4);
  background: var(--amber-bg);
  border-top: 1px dashed var(--amber-line);
  font-family: var(--mono);
  font-size: var(--t-12);
  color: var(--amber);
}
</style>

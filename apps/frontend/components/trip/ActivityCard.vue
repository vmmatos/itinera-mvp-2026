<script setup lang="ts">
import { computed } from 'vue'
import { AGENT_COLOURS } from '~/types/index'
import type { TransportActivityData, TransportOption } from '~/types/index'
import { routeIcon, formatDuration, optHeadLabel, priceDelta, transitQualifier } from '~/utils/itinerary'

export interface ActivityCardProps {
  venue?:         string
  city?:          string
  country?:       string
  location?:      string
  name:           string
  cost?:          number
  durationMinutes?: number
  weatherAlert?:  string
  ownerAgent?:    string
  notes?:         string
  transportData?: TransportActivityData
}

const { t } = useI18n()

const props = withDefaults(defineProps<{
  activity:        ActivityCardProps
  isDebug?:        boolean
  currencySymbol?: string
}>(), {
  isDebug:        false,
  currencySymbol: '€',
})

// ── Transport card helpers ───────────────────────────────────
const td = computed<TransportActivityData | undefined>(() => props.activity.transportData)

// Alternatives stripped of bogus 0-duration entries (hub→dest API misses).
const validAlts = computed<TransportOption[]>(() =>
  (td.value?.alternatives ?? []).filter((a) => a.durationMinutes > 0),
)

// Price/duration live in displaySummary for multi-leg, so suppress the
// redundant badges in that case and only surface the departure time.
function showPriceDur(opt: TransportOption): boolean {
  return !opt.displaySummary
}

// One-line qualifier under the selected option: why it was picked.
const qualifier = computed<string>(() => {
  const sel = td.value?.selectedOption
  if (!sel) return ''
  return transitQualifier(sel, validAlts.value)
})

const venueLine = computed(() => {
  const location = props.activity.location?.trim() ?? ''
  const country = props.activity.country?.trim() ?? ''

  return (country && location) 
    ? `${location}, ${country}` 
    : location
})

const COLOUR_CODE: Record<string, string> = {
  green: 'g', amber: 'a', blue: 'b', magenta: 'm',
}

function agentColour(agent: string): string {
  return AGENT_COLOURS[agent as keyof typeof AGENT_COLOURS] ?? 'green'
}

function agentCssVar(agent: string): string {
  return `var(--${agentColour(agent)})`
}

function agentBgVar(agent: string): string {
  return `var(--${agentColour(agent)}-bg)`
}

function agentLineVar(agent: string): string {
  return `var(--${agentColour(agent)}-line)`
}
</script>

<template>
  <!-- Transport leg card -->
  <div v-if="td" class="ac-transport">
    <!-- Selected option: icon + route on the left, badges on the right -->
    <div class="ac-tr-main">
      <span class="ac-tr-icon">{{ routeIcon(td.selectedOption) }}</span>
      <span class="ac-tr-route">{{ optHeadLabel(td.selectedOption, td.to) }}</span>
      <span class="ac-tr-badges">
        <span
          v-if="showPriceDur(td.selectedOption) && td.selectedOption.priceEur"
          class="ac-tr-badge ac-tr-badge-price"
        >€{{ td.selectedOption.priceEur }}/person</span>
        <span
          v-if="showPriceDur(td.selectedOption)"
          class="ac-tr-badge"
        >{{ formatDuration(td.selectedOption.durationMinutes) }}</span>
        <span
          v-if="td.selectedOption.departureTime"
          class="ac-tr-badge ac-tr-badge-time"
        >{{ td.selectedOption.departureTime }}</span>
      </span>
    </div>

    <!-- Departure / arrival airport (direct flights only, no segments) -->
    <div
      v-if="!td.selectedOption.segments?.length && (td.selectedOption.originAirport || td.selectedOption.destinationAirport)"
      class="ac-tr-airports"
    >
      <span v-if="td.selectedOption.originAirport">✈ {{ td.selectedOption.originAirport }}</span>
      <span v-if="td.selectedOption.originAirport && td.selectedOption.destinationAirport"> → </span>
      <span v-if="td.selectedOption.destinationAirport">{{ td.selectedOption.destinationAirport }}</span>
    </div>

    <!-- Segment details: stop names + provider per leg (multi-leg routes) -->
    <div
      v-if="td.selectedOption.segments?.length"
      class="ac-tr-segments"
    >
      <div
        v-for="(seg, si) in td.selectedOption.segments"
        :key="si"
        class="ac-tr-seg"
      >
        <span class="ac-tr-seg-icon">{{ seg.mode === 'flight' ? '✈' : seg.mode === 'train' ? '🚆' : seg.mode === 'bus' ? '🚌' : '🚗' }}</span>
        <span class="ac-tr-seg-body">
          <span class="ac-tr-seg-route">{{ seg.from }} → {{ seg.to }}</span>
          <span v-if="seg.provider" class="ac-tr-seg-provider"> · {{ seg.provider }}</span>
          <span v-if="seg.trainLine && seg.trainLine !== seg.provider" class="ac-tr-seg-line"> ({{ seg.trainLine }})</span>
          <span v-if="seg.flightNumber" class="ac-tr-seg-line"> · {{ seg.flightNumber }}</span>
          <span v-if="seg.fromStop || seg.toStop" class="ac-tr-seg-stops">
            <template v-if="seg.fromStop">🚏 Board at: {{ seg.fromStop }}</template>
            <template v-if="seg.fromStop && seg.toStop"> · </template>
            <template v-if="seg.toStop">Alight at: {{ seg.toStop }}</template>
          </span>
        </span>
        <span v-if="seg.departureTime" class="ac-tr-seg-time">{{ seg.departureTime }}</span>
      </div>
    </div>

    <!-- Direct train/bus stops (no segments) -->
    <div
      v-if="!td.selectedOption.segments?.length && (td.selectedOption.fromStop || td.selectedOption.toStop)"
      class="ac-tr-airports"
    >
      <template v-if="td.selectedOption.fromStop">🚏 {{ td.selectedOption.fromStop }}</template>
      <template v-if="td.selectedOption.fromStop && td.selectedOption.toStop"> → </template>
      <template v-if="td.selectedOption.toStop">{{ td.selectedOption.toStop }}</template>
    </div>

    <!-- Why this option won -->
    <div class="ac-tr-qualifier">{{ qualifier }}</div>

    <!-- Warnings -->
    <div
      v-for="(w, wi) in td.selectedOption.warnings"
      :key="wi"
      class="ac-transport-warn"
    >⚠ {{ w }}</div>

    <!-- Alternatives -->
    <details v-if="validAlts.length > 0" class="ac-transport-alts">
      <summary>{{ validAlts.length }} other option{{ validAlts.length > 1 ? 's' : '' }}</summary>
      <div
        v-for="(alt, ai) in validAlts"
        :key="ai"
        class="ac-tr-alt"
      >
        <span class="ac-tr-alt-icon">{{ routeIcon(alt) }}</span>
        <span class="ac-tr-alt-route">{{ optHeadLabel(alt, td.to) }}</span>
        <span class="ac-tr-alt-meta">
          <template v-if="alt.departureTime">{{ alt.departureTime }} · </template>
          <template v-if="showPriceDur(alt) && alt.priceEur">
            €{{ alt.priceEur }}<span
              v-if="priceDelta(alt, td.selectedOption)"
              class="ac-tr-delta"
            > ({{ priceDelta(alt, td.selectedOption) }})</span> ·
          </template>
          {{ formatDuration(alt.durationMinutes) }}
        </span>
      </div>
    </details>
  </div>

  <!-- Standard activity card -->
  <div v-else class="act-card">
    <div class="act-top">
      <p class="act-name">{{ activity.name }}</p>
      <div class="act-badges">
        <span
          v-if="activity.weatherAlert"
          class="badge-weather"
        >⚠ {{ activity.weatherAlert }}</span>
        <span
          v-if="activity.cost"
          class="badge-cost"
        >{{ currencySymbol }}{{ activity.cost }}</span>
        <span
          v-if="activity.durationMinutes"
          class="badge-duration"
        >{{ formatDuration(activity.durationMinutes) }}</span>
        <span
          v-if="activity.ownerAgent"
          class="badge-agent"
          :style="`color:${agentCssVar(activity.ownerAgent)};background:${agentBgVar(activity.ownerAgent)};border-color:${agentLineVar(activity.ownerAgent)}`"
        >{{ t('trip.itinerary.daySlot.proposedBy') }} {{ activity.ownerAgent }}</span>
      </div>
    </div>
    <div v-if="venueLine" class="act-city">
      <svg class="pin-green" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <path d="M8 1.5C5.51 1.5 3.5 3.51 3.5 6c0 3.75 4.5 8.5 4.5 8.5s4.5-4.75 4.5-8.5c0-2.49-2.01-4.5-4.5-4.5zm0 6a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z" fill="currentColor"/>
      </svg>
      <span>{{ venueLine }}</span>
    </div>
    <p v-if="activity.notes" class="act-notes">{{ activity.notes }}</p>
  </div>
</template>

<style scoped>
.act-card {
  padding: var(--s-2) var(--s-3);
  margin-bottom: 2px;
  border-radius: var(--r-1);
  background: var(--bg-2);
  border: 1px solid rgba(255, 255, 255, 0.04);
}

.act-top {
  display: flex;
  align-items: center;
  gap: var(--s-2);
  flex-wrap: wrap;
  margin-bottom: 2px;
}

.act-name {
  margin: 0;
  font-size: var(--t-14);
  color: var(--fg-0);
  font-weight: 500;
}

.act-badges {
  display: flex;
  align-items: center;
  gap: var(--s-2);
  flex-wrap: wrap;
}

.badge-weather {
  font-family: var(--mono);
  font-size: 10px;
  color: var(--amber);
  background: var(--amber-bg);
  border: 1px solid var(--amber-line);
  padding: 1px 6px;
  border-radius: var(--r-1);
}

.badge-cost {
  font-family: var(--mono);
  font-size: var(--t-12);
  color: var(--red);
}

.badge-duration {
  font-family: var(--mono);
  font-size: var(--t-12);
  color: var(--fg-2);
}

.badge-agent {
  font-family: var(--mono);
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  padding: 1px 6px;
  border-radius: var(--r-1);
  border: 1px solid;
}

.act-venue {
  margin: 3px 0 1px;
  font-size: var(--t-13);
  color: var(--fg-1);
  font-weight: 400;
  line-height: 1.3;
}

.act-city {
  display: flex;
  align-items: center;
  gap: 3px;
  font-family: var(--mono);
  font-size: 10px;
  color: var(--green);
  opacity: 0.75;
  letter-spacing: 0.03em;
  margin-bottom: 2px;
}

.pin-green {
  width: 10px;
  height: 10px;
  flex-shrink: 0;
  color: var(--green);
}

.act-notes {
  margin: 2px 0 0;
  font-size: var(--t-12);
  color: var(--fg-3);
  font-style: italic;
}

/* ── Transport leg card ──────────────────────────────────────── */
.ac-transport {
  padding: var(--s-2) var(--s-3);
  margin-bottom: 2px;
  border-radius: var(--r-1);
  background: rgba(0, 170, 255, 0.06);
  border: 1px solid rgba(0, 170, 255, 0.18);
}

.ac-tr-main {
  display: flex;
  align-items: center;
  gap: var(--s-2);
}

.ac-tr-icon {
  font-size: 15px;
  line-height: 1;
  flex-shrink: 0;
}

.ac-tr-route {
  font-family: var(--mono);
  font-size: var(--t-12);
  color: var(--fg-0);
  font-weight: 500;
  flex: 1;
  min-width: 0;
}

.ac-tr-badges {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.ac-tr-badge {
  font-family: var(--mono);
  font-size: 10px;
  color: var(--fg-2);
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: var(--r-1);
  padding: 1px 6px;
  white-space: nowrap;
}

.ac-tr-badge-price {
  color: var(--green);
  background: var(--g-bg, rgba(0, 200, 120, 0.08));
  border-color: var(--g-line, rgba(0, 200, 120, 0.22));
}

.ac-tr-badge-time {
  color: var(--fg-1);
}

.ac-tr-airports {
  font-family: var(--mono);
  font-size: 10px;
  color: var(--fg-2);
  margin-top: 3px;
  letter-spacing: 0.02em;
  opacity: 0.8;
}

.ac-tr-segments {
  margin-top: 6px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.ac-tr-seg {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  font-family: var(--mono);
  font-size: 10px;
  color: var(--fg-2);
  padding: 4px 6px;
  background: rgba(255, 255, 255, 0.03);
  border-left: 2px solid rgba(0, 170, 255, 0.25);
  border-radius: 0 var(--r-1) var(--r-1) 0;
}

.ac-tr-seg-icon {
  flex-shrink: 0;
  line-height: 1.4;
}

.ac-tr-seg-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.ac-tr-seg-route {
  color: var(--fg-1);
  font-weight: 500;
}

.ac-tr-seg-provider {
  color: var(--fg-3);
}

.ac-tr-seg-line {
  color: var(--fg-3);
}

.ac-tr-seg-stops {
  color: var(--fg-3);
  font-size: 9px;
  opacity: 0.85;
  margin-top: 1px;
}

.ac-tr-seg-time {
  flex-shrink: 0;
  color: var(--fg-2);
  align-self: flex-start;
}

.ac-tr-qualifier {
  font-family: var(--mono);
  font-size: 10px;
  color: var(--fg-3);
  margin-top: 4px;
  letter-spacing: 0.02em;
}

.ac-tr-alt {
  display: flex;
  align-items: baseline;
  gap: 6px;
  font-family: var(--mono);
  font-size: var(--t-12);
  color: var(--fg-2);
  padding: 3px 0 3px var(--s-3);
  border-left: 1px solid rgba(255, 255, 255, 0.08);
  margin-top: 3px;
}

.ac-tr-alt-icon {
  flex-shrink: 0;
}

.ac-tr-alt-route {
  flex: 1;
  min-width: 0;
  color: var(--fg-1);
}

.ac-tr-alt-meta {
  flex-shrink: 0;
  color: var(--fg-3);
  white-space: nowrap;
}

.ac-tr-delta {
  color: var(--amber);
}

.ac-transport-warn {
  font-family: var(--mono);
  font-size: 10px;
  color: var(--amber);
  background: var(--amber-bg);
  border: 1px solid var(--amber-line);
  border-radius: var(--r-1);
  padding: 1px 6px;
  margin-top: 4px;
  display: inline-block;
}

.ac-transport-alts {
  margin-top: var(--s-2);
}

.ac-transport-alts summary {
  font-family: var(--mono);
  font-size: 10px;
  color: var(--fg-3);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  cursor: pointer;
  user-select: none;
}

</style>

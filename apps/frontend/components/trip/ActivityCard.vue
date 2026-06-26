<script setup lang="ts">
import { computed } from 'vue'
import { AGENT_COLOURS } from '~/types/index'
import type { TransportActivityData, TransportOption } from '~/types/index'
import { routeIcon, formatDuration } from '~/utils/itinerary'

export interface ActivityCardProps {
  venue?:         string
  city?:          string
  country?:       string
  location?:      string
  name:           string
  cost?:          number
  weatherAlert?:  string
  ownerAgent?:    string
  notes?:         string
  transportData?: TransportActivityData
}

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

function modeName(mode: string): string {
  return mode === 'flight' ? 'Flight' : mode === 'train' ? 'Train' : mode === 'bus' ? 'Bus' : 'Drive'
}

// Route text for the row header. Multi-leg routes carry a pre-built
// displaySummary (e.g. "Bus + Train + Flight — 9h, ~€172/person"); direct
// routes get "Train TGV →Barcelona" style with the provider/ref.
function optHeadLabel(opt: TransportOption, to: string): string {
  if (opt.displaySummary) return opt.displaySummary
  const ref = opt.flightNumber ?? opt.trainLine ?? opt.provider ?? ''
  return `${modeName(opt.mode)}${ref ? ` ${ref}` : ''} →${to}`
}

// Price/duration live in displaySummary for multi-leg, so suppress the
// redundant badges in that case and only surface the departure time.
function showPriceDur(opt: TransportOption): boolean {
  return !opt.displaySummary
}

function priceDelta(alt: TransportOption, base?: TransportOption): string {
  if (typeof alt.priceEur !== 'number' || typeof base?.priceEur !== 'number') return ''
  const d = alt.priceEur - base.priceEur
  if (d === 0) return ''
  return d > 0 ? `+€${d}` : `−€${Math.abs(d)}`
}

// One-line qualifier under the selected option: why it was picked.
const qualifier = computed<string>(() => {
  const sel = td.value?.selectedOption
  if (!sel) return ''
  const all = [sel, ...validAlts.value]
  const priced = all.filter((o) => typeof o.priceEur === 'number') as Array<TransportOption & { priceEur: number }>

  if (priced.length > 1 && typeof sel.priceEur === 'number') {
    const cheapest = Math.min(...priced.map((o) => o.priceEur))
    if (sel.priceEur === cheapest) {
      const nextUp = priced.map((o) => o.priceEur).filter((p) => p > cheapest).sort((a, b) => a - b)[0]
      if (nextUp !== undefined) return `Cheapest option — €${sel.priceEur} vs €${nextUp} alternative`
    }
  }

  if (validAlts.value.length > 0) {
    const fastest = Math.min(...all.map((o) => o.durationMinutes))
    if (sel.durationMinutes === fastest) {
      const nextSlower = all.map((o) => o.durationMinutes).filter((m) => m > fastest).sort((a, b) => a - b)[0]
      if (nextSlower !== undefined) return `Fastest option — ${formatDuration(sel.durationMinutes)} vs ${formatDuration(nextSlower)}`
    }
  }

  return 'Recommended option'
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

    <!-- Departure / arrival airport (flights only) -->
    <div
      v-if="td.selectedOption.originAirport || td.selectedOption.destinationAirport"
      class="ac-tr-airports"
    >
      <span v-if="td.selectedOption.originAirport">✈ {{ td.selectedOption.originAirport }}</span>
      <span v-if="td.selectedOption.originAirport && td.selectedOption.destinationAirport"> → </span>
      <span v-if="td.selectedOption.destinationAirport">{{ td.selectedOption.destinationAirport }}</span>
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
          v-if="isDebug && activity.ownerAgent"
          class="badge-agent"
          :style="`color:${agentCssVar(activity.ownerAgent)};background:${agentBgVar(activity.ownerAgent)};border-color:${agentLineVar(activity.ownerAgent)}`"
        >{{ activity.ownerAgent }}</span>
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

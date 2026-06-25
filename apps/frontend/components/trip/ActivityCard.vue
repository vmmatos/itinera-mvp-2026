<script setup lang="ts">
import { computed } from 'vue'
import { AGENT_COLOURS } from '~/types/index'
import type { TransportActivityData } from '~/types/index'
import { modeIcon, routeIcon } from '~/utils/itinerary'

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
  <div v-if="activity.transportData" class="ac-transport">
    <div class="ac-transport-head">
      <span class="ac-transport-icon">{{ routeIcon(activity.transportData.selectedOption) }}</span>
      <span class="ac-transport-label">{{ activity.name }}</span>
    </div>
    <div
      v-for="(w, wi) in activity.transportData.selectedOption.warnings"
      :key="wi"
      class="ac-transport-warn"
    >⚠ {{ w }}</div>
    <details v-if="activity.transportData.alternatives.filter(a => a.durationMinutes > 0).length > 0" class="ac-transport-alts">
      <summary>{{ activity.transportData.alternatives.filter(a => a.durationMinutes > 0).length }} alternative{{ activity.transportData.alternatives.filter(a => a.durationMinutes > 0).length > 1 ? 's' : '' }}</summary>
      <div
        v-for="(alt, ai) in activity.transportData.alternatives.filter(a => a.durationMinutes > 0)"
        :key="ai"
        class="ac-transport-alt-row"
      >
        <template v-if="alt.displaySummary">
          {{ routeIcon(alt) }} →{{ activity.transportData.to }} — {{ alt.displaySummary }}
        </template>
        <template v-else>
          {{ modeIcon(alt.mode) }}
          {{ alt.mode === 'flight' ? 'Flight' : alt.mode === 'train' ? 'Train' : alt.mode === 'bus' ? 'Bus' : 'Drive' }}
          <template v-if="alt.flightNumber ?? alt.trainLine">{{ alt.flightNumber ?? alt.trainLine }}</template>
          →{{ activity.transportData.to }}
          <template v-if="alt.departureTime">{{ alt.departureTime }}</template>
          <template v-if="alt.priceEur"> · €{{ alt.priceEur }}/person</template>
          · {{ Math.floor(alt.durationMinutes / 60) }}h{{ alt.durationMinutes % 60 > 0 ? ` ${alt.durationMinutes % 60}m` : '' }}
        </template>
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

.ac-transport-head {
  display: flex;
  align-items: center;
  gap: var(--s-2);
}

.ac-transport-icon {
  font-size: 15px;
  line-height: 1;
}

.ac-transport-label {
  font-family: var(--mono);
  font-size: var(--t-12);
  color: var(--fg-0);
  font-weight: 500;
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

.ac-transport-alt-row {
  font-family: var(--mono);
  font-size: var(--t-12);
  color: var(--fg-2);
  padding: 3px 0 3px var(--s-3);
  border-left: 1px solid rgba(255, 255, 255, 0.08);
  margin-top: 3px;
}
</style>

<script setup lang="ts">
import { computed } from 'vue'
import { AGENT_COLOURS } from '~/types/index'

export interface ActivityCardProps {
  venue?:        string
  city?:         string
  country?:      string
  location?:     string
  name:          string
  cost?:         number
  weatherAlert?: string
  ownerAgent?:   string
  notes?:        string
}

const props = withDefaults(defineProps<{
  activity:        ActivityCardProps
  isDebug?:        boolean
  currencySymbol?: string
}>(), {
  isDebug:        false,
  currencySymbol: '€',
})

// venue shown in fg-1 (prominent); city+country in green below
const venueLine = computed((): string => props.activity.venue?.trim() ?? '')

const cityLine = computed((): string => {
  const city    = props.activity.city?.trim()
  const country = props.activity.country?.trim()
  if (city && country) return `${city}, ${country}`
  if (city)            return city
  // no structured city — fall back to legacy location only when venue absent
  if (!venueLine.value) return props.activity.location?.trim() ?? ''
  return ''
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
  <div class="act-card">
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
    <p v-if="venueLine" class="act-venue">{{ venueLine }}</p>
    <div v-if="cityLine" class="act-city">
      <svg class="pin-green" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <path d="M8 1.5C5.51 1.5 3.5 3.51 3.5 6c0 3.75 4.5 8.5 4.5 8.5s4.5-4.75 4.5-8.5c0-2.49-2.01-4.5-4.5-4.5zm0 6a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z" fill="currentColor"/>
      </svg>
      <span>{{ cityLine }}</span>
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
</style>

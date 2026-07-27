<script setup lang="ts">
import type { SlotItemVM, Phase } from '~/utils/itineraryViewModel'
import { formatMoney } from '~/utils/itineraryViewModel'
import { agentColorToken } from '~/utils/agentColorTokens'
import { AGENT_COLOURS, type AgentName } from '~/types/index'
import TripItineraryTransitBlock from './TransitBlock.vue'

const props = defineProps<{
  slot: SlotItemVM
  phase: Phase
  priceMode: 'pp' | 'total'
  travellers: number
  currencySymbol: string
}>()

const PHASE_ICON: Record<Phase, string> = { morning: '🌅', afternoon: '☀️', evening: '🌙' }

function agentColor(name?: string): string {
  if (!name) return agentColorToken('neutral')
  const colour = AGENT_COLOURS[name as AgentName]
  return agentColorToken(colour ?? 'neutral')
}
</script>

<template>
  <div class="slot" data-testid="day-slot">
    <div class="when">
      <span class="ph"><span class="ic">{{ PHASE_ICON[props.phase] }}</span>{{ props.phase }}</span>
    </div>
    <div class="item">
      <h3>{{ props.slot.title }}</h3>
      <p v-if="props.slot.description">{{ props.slot.description }}</p>
      <div v-if="props.slot.costPerPerson || props.slot.agentName" class="tags">
        <span v-if="props.slot.costPerPerson" class="tag cost">
          {{ formatMoney(props.slot.costPerPerson, props.priceMode, props.travellers, props.currencySymbol) }}
        </span>
        <span v-if="props.slot.agentName" class="tag by">
          proposed by <i :style="`color:${agentColor(props.slot.agentName)}`">{{ props.slot.agentName }}</i>
        </span>
      </div>
      <TripItineraryTransitBlock
        v-if="props.slot.transit"
        :transit="props.slot.transit"
        :price-mode="props.priceMode"
        :travellers="props.travellers"
      />
    </div>
  </div>
</template>

<style scoped>
.slot { display: grid; grid-template-columns: 120px 1fr; gap: var(--s-5); padding: var(--s-5) 0; border-bottom: var(--hair-soft); }
.slot:last-child { border-bottom: none; }
.when .ph { font-family: var(--mono); font-size: var(--t-12); color: var(--fg-2); text-transform: uppercase; letter-spacing: .08em; display: flex; align-items: center; gap: 7px; }
.item h3 { margin: 0 0 6px; font-size: var(--t-16); font-weight: 500; letter-spacing: -0.01em; }
.item p { margin: 0; color: var(--fg-2); font-size: var(--t-15); max-width: 64ch; line-height: 1.55; }
.tags { display: flex; gap: var(--s-2); margin-top: var(--s-3); flex-wrap: wrap; }
.tag { font-family: var(--mono); font-size: var(--t-12); text-transform: uppercase; letter-spacing: .06em; padding: 2px var(--s-2); border: var(--hair); color: var(--fg-2); border-radius: var(--r-1); }
.tag.cost { color: var(--fg-1); }
.tag.by i { font-style: normal; }
@media (max-width: 640px) {
  .slot { grid-template-columns: 1fr; gap: var(--s-2); }
}
</style>

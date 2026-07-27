<script setup lang="ts">
import { ref } from 'vue'
import type { TransitVM } from '~/utils/itineraryViewModel'
import { formatEur } from '~/utils/itineraryViewModel'

const props = defineProps<{
  transit: TransitVM
  priceMode: 'pp' | 'total'
  travellers: number
}>()

const open = ref(false)
</script>

<template>
  <div class="transit-block" data-testid="transit-block">
    <div class="tr-top">
      <span class="mode">{{ props.transit.icon }} {{ props.transit.modeLabel }} → {{ props.transit.destination }}</span>
      <span v-if="props.transit.priceEurPerPerson" class="pill" data-testid="transit-price">
        {{ formatEur(props.transit.priceEurPerPerson, props.priceMode, props.travellers) }}
      </span>
      <span class="dur">{{ props.transit.durationLabel }}</span>
    </div>
    <div v-if="props.transit.subLabel" class="tr-sub">{{ props.transit.subLabel }}</div>
    <div v-if="props.transit.warning" class="tr-warn">⚠ {{ props.transit.warning }}</div>
    <div
      v-if="props.transit.alternatives.length > 0"
      class="tr-alts"
      data-testid="transit-alts-toggle"
      role="button"
      tabindex="0"
      @click="open = !open"
      @keydown.enter="open = !open"
    >
      {{ open ? '▾' : '▸' }} {{ props.transit.alternatives.length }} other option{{ props.transit.alternatives.length === 1 ? '' : 's' }}
    </div>
    <div v-if="open" class="alt-list">
      <div v-for="(alt, i) in props.transit.alternatives" :key="i" class="alt" data-testid="transit-alt">
        <span class="m">{{ alt.icon }} {{ alt.label }}</span>
        <span class="d">{{ alt.durationLabel }}</span>
        <span v-if="alt.priceEurPerPerson" class="c">{{ formatEur(alt.priceEurPerPerson, props.priceMode, props.travellers) }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.transit-block { margin-top: var(--s-3); border: 1px solid var(--blue-line); background: var(--blue-bg); padding: var(--s-3) var(--s-4); border-radius: var(--r-2); }
.tr-top { display: flex; align-items: center; gap: var(--s-3); flex-wrap: wrap; }
.mode { font-family: var(--mono); font-size: var(--t-15); color: var(--fg-0); }
.pill { margin-left: auto; font-family: var(--mono); font-size: var(--t-12); color: var(--green); border: 1px solid var(--green-line); background: var(--green-bg); padding: 2px var(--s-2); border-radius: var(--r-1); }
.dur { font-family: var(--mono); font-size: var(--t-12); color: var(--fg-2); border: var(--hair); padding: 2px var(--s-2); border-radius: var(--r-1); }
.tr-sub { font-family: var(--mono); font-size: var(--t-12); color: var(--fg-3); margin-top: var(--s-2); }
.tr-warn { margin-top: var(--s-2); font-family: var(--mono); font-size: var(--t-12); color: var(--amber); border: 1px solid var(--amber-line); background: var(--amber-bg); padding: 5px 9px; display: inline-block; border-radius: var(--r-1); }
.tr-alts { margin-top: var(--s-2); font-family: var(--mono); font-size: var(--t-12); color: var(--fg-3); cursor: pointer; }
.tr-alts:hover { color: var(--fg-1); }
.alt-list { margin-top: var(--s-2); display: flex; flex-direction: column; gap: 4px; }
.alt { display: flex; align-items: center; gap: var(--s-3); font-family: var(--mono); font-size: var(--t-12); color: var(--fg-2); padding: 5px var(--s-2); border: var(--hair-soft); background: var(--bg-1); }
.alt .c { margin-left: auto; color: var(--fg-1); }
.alt .d { color: var(--fg-3); }
</style>

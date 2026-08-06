<script setup lang="ts">
import { ref } from 'vue'
import type { TransitVM } from '~/utils/itineraryViewModel'
import { formatEur } from '~/utils/itineraryViewModel'

const { t } = useI18n()

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
      <span class="mode">{{ props.transit.icon }} {{ props.transit.routeLabel }}</span>
      <span class="badges">
        <span v-if="props.transit.priceEurPerPerson" class="pill" data-testid="transit-price">
          {{ formatEur(props.transit.priceEurPerPerson, props.priceMode, props.travellers) }}
        </span>
        <span class="dur">{{ props.transit.durationLabel }}</span>
        <span v-if="props.transit.departureTime" class="time">{{ props.transit.departureTime }}</span>
      </span>
    </div>
    <div v-if="props.transit.subLabel" class="tr-sub">{{ props.transit.subLabel }}</div>
    <div class="tr-qualifier" data-testid="transit-qualifier">{{ props.transit.qualifier }}</div>
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
      {{ open ? '▾' : '▸' }} {{ props.transit.alternatives.length }} {{ t(props.transit.alternatives.length === 1 ? 'trip.itinerary.transitBlock.otherOption' : 'trip.itinerary.transitBlock.otherOptionsPlural') }}
    </div>
    <div v-if="open" class="alt-list">
      <div v-for="(alt, i) in props.transit.alternatives" :key="i" class="alt" data-testid="transit-alt">
        <span class="m">{{ alt.icon }} {{ alt.routeLabel }}</span>
        <span class="meta">
          <template v-if="alt.departureTime">{{ alt.departureTime }} · </template>
          <template v-if="alt.priceEurPerPerson">
            {{ formatEur(alt.priceEurPerPerson, props.priceMode, props.travellers) }}<span
              v-if="alt.priceDeltaLabel"
              class="delta"
            > ({{ alt.priceDeltaLabel }})</span> ·
          </template>
          {{ alt.durationLabel }}
        </span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.transit-block { margin-top: var(--s-3); border: 1px solid var(--blue-line); background: var(--blue-bg); padding: var(--s-3) var(--s-4); border-radius: var(--r-2); }
.tr-top { display: flex; align-items: center; gap: var(--s-3); flex-wrap: wrap; }
.mode { font-family: var(--mono); font-size: var(--t-15); color: var(--fg-0); flex: 1; min-width: 0; }
.badges { margin-left: auto; display: flex; align-items: center; gap: 4px; flex-wrap: wrap; justify-content: flex-end; }
.pill { font-family: var(--mono); font-size: var(--t-12); color: var(--green); border: 1px solid var(--green-line); background: var(--green-bg); padding: 2px var(--s-2); border-radius: var(--r-1); }
.dur { font-family: var(--mono); font-size: var(--t-12); color: var(--fg-2); border: var(--hair); padding: 2px var(--s-2); border-radius: var(--r-1); }
.time { font-family: var(--mono); font-size: var(--t-12); color: var(--fg-1); }
.tr-sub { font-family: var(--mono); font-size: var(--t-12); color: var(--fg-3); margin-top: var(--s-2); }
.tr-qualifier { font-family: var(--mono); font-size: var(--t-12); color: var(--fg-3); margin-top: var(--s-2); letter-spacing: 0.02em; }
.tr-warn { margin-top: var(--s-2); font-family: var(--mono); font-size: var(--t-12); color: var(--amber); border: 1px solid var(--amber-line); background: var(--amber-bg); padding: 5px 9px; display: inline-block; border-radius: var(--r-1); }
.tr-alts { margin-top: var(--s-2); font-family: var(--mono); font-size: var(--t-12); color: var(--fg-3); cursor: pointer; }
.tr-alts:hover { color: var(--fg-1); }
.alt-list { margin-top: var(--s-2); display: flex; flex-direction: column; gap: 4px; }
.alt { display: flex; align-items: baseline; gap: var(--s-3); font-family: var(--mono); font-size: var(--t-12); color: var(--fg-2); padding: 5px var(--s-2); border: var(--hair-soft); background: var(--bg-1); }
.alt .m { flex: 1; min-width: 0; color: var(--fg-1); }
.alt .meta { margin-left: auto; flex-shrink: 0; color: var(--fg-3); white-space: nowrap; }
.alt .delta { color: var(--amber); }
</style>

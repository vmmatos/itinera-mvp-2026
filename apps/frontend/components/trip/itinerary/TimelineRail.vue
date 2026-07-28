<script setup lang="ts">
import type { SegmentVM, DayVM } from '~/utils/itineraryViewModel'
import { formatMoney } from '~/utils/itineraryViewModel'

const props = defineProps<{
  segments: SegmentVM[]
  days: DayVM[]
  selectedDay: number
  priceMode: 'pp' | 'total'
  travellers: number
  currencySymbol: string
  showWeather: boolean
}>()

defineEmits<{ select: [index: number] }>()
</script>

<template>
  <div class="rail-wrap">
    <div class="rail-top">
      <span class="lbl">trip timeline · <b>{{ props.days.length }} days</b> · <b>{{ props.segments.length }} stop{{ props.segments.length === 1 ? '' : 's' }}</b> · click a day to focus</span>
      <span class="dates">weather · {{ props.showWeather ? 'live forecast · fixed dates' : 'no live forecast — flexible dates' }}</span>
    </div>
    <div class="rail-scroll">
      <div class="rail">
        <template v-for="(seg, si) in props.segments" :key="si">
          <div class="seg-group">
            <div class="seg-label">{{ seg.city }}<span class="bracket" /></div>
            <div class="days-row">
              <div
                v-for="di in seg.dayIndexes"
                :key="di"
                class="daycell"
                :class="{ sel: di === props.selectedDay, transit: props.days[di]?.isTransitDay }"
                data-testid="day-cell"
                :data-day-index="di"
                @click="$emit('select', di)"
              >
                <div class="dn"><span>D{{ props.days[di]?.day }}</span><span class="dd">{{ props.days[di]?.dateLabel }}</span></div>
                <div v-if="props.days[di]?.weather" class="wx">
                  <span class="ic">{{ props.days[di]?.weather?.icon }}</span>
                  <span v-if="props.days[di]?.weather?.tempHigh !== undefined" class="tp">
                    {{ props.days[di]?.weather?.tempHigh }}°<small>/{{ props.days[di]?.weather?.tempLow }}°</small>
                  </span>
                </div>
                <div class="cst">{{ formatMoney(props.days[di]?.costPerPerson ?? 0, props.priceMode, props.travellers, props.currencySymbol) }}</div>
                <span v-if="props.days[di]?.weather?.risk === 'heat'" class="heat" data-testid="heat-flag">▲</span>
              </div>
            </div>
          </div>
          <div v-if="seg.transitAfter" class="transit-gap">
            <div class="tnode">
              <span class="ico">{{ seg.transitAfter.icon }}</span>
              <span class="tt">{{ seg.transitAfter.label }}</span>
            </div>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.rail-wrap { flex-shrink: 0; border-bottom: var(--hair); background: var(--bg-1); padding: var(--s-3) var(--s-6) var(--s-4); position: relative; }
.rail-top { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: var(--s-3); flex-wrap: wrap; gap: var(--s-2); }
.rail-top .lbl { font-family: var(--mono); font-size: var(--t-12); color: var(--fg-3); text-transform: uppercase; letter-spacing: .08em; }
.rail-top .lbl b { color: var(--fg-1); font-weight: 500; }
.rail-top .dates { font-family: var(--mono); font-size: var(--t-12); color: var(--fg-3); }
.rail-scroll { overflow-x: auto; padding-bottom: 4px; }
.rail { display: flex; gap: 0; min-width: min-content; position: relative; }
.seg-group { display: flex; flex-direction: column; position: relative; padding-top: 20px; }
.seg-label { position: absolute; top: 0; left: 0; right: 8px; display: flex; align-items: center; gap: 6px; font-family: var(--mono); font-size: 10px; color: var(--fg-2); text-transform: uppercase; letter-spacing: .08em; white-space: nowrap; }
.seg-label::before { content: ""; width: 5px; height: 5px; background: var(--green); border-radius: 50%; }
.seg-label .bracket { flex: 1; height: 1px; background: var(--line-2); margin-left: 2px; }
.days-row { display: flex; gap: 6px; }
.transit-gap { align-self: stretch; display: flex; align-items: center; padding-top: 20px; }
.transit-gap .tnode { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 0 var(--s-3); margin: 0 2px; border-left: 1px dashed var(--line-2); border-right: 1px dashed var(--line-2); color: var(--fg-3); }
.transit-gap .tnode .ico { font-size: var(--t-16); }
.transit-gap .tnode .tt { font-family: var(--mono); font-size: 9px; text-transform: uppercase; letter-spacing: .04em; white-space: nowrap; }
.daycell { width: 88px; flex-shrink: 0; border: var(--hair); background: var(--bg-2); padding: var(--s-2) var(--s-2) 9px; cursor: pointer; display: flex; flex-direction: column; gap: 5px; transition: border-color .12s, background .12s; position: relative; }
.daycell:hover { border-color: var(--line-3); }
.daycell.sel { border-color: var(--green-line); background: var(--green-bg); }
.daycell.sel::after { content: ""; position: absolute; left: 0; right: 0; bottom: -14px; height: 2px; background: var(--green); }
.daycell .dn { font-family: var(--mono); font-size: var(--t-12); color: var(--fg-1); display: flex; justify-content: space-between; align-items: baseline; }
.daycell.sel .dn { color: var(--green); }
.daycell .dn .dd { color: var(--fg-4); font-size: 9px; }
.daycell .wx { display: flex; align-items: center; gap: 5px; }
.daycell .wx .ic { font-size: var(--t-16); line-height: 1; }
.daycell .wx .tp { font-family: var(--mono); font-size: var(--t-13); color: var(--fg-1); }
.daycell .wx .tp small { color: var(--fg-4); }
.daycell .cst { font-family: var(--mono); font-size: 10px; color: var(--fg-3); }
.daycell.sel .cst { color: var(--fg-2); }
.daycell .heat { position: absolute; top: 6px; right: 6px; font-size: 9px; color: var(--amber); }
.daycell.transit .dn::after { content: "⇢"; color: var(--amber); margin-left: 4px; }
</style>

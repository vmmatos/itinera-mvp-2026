<script setup lang="ts">
import { computed } from 'vue'
import type { TravellerScore } from '~/types/index'

const props = defineProps<{ scores: TravellerScore[] }>()

const rows = computed(() =>
  props.scores.map((s) => ({
    ...s,
    pct: Math.max(0, Math.min(100, Math.round(s.score))),
  })),
)
</script>

<template>
  <div v-if="rows.length > 0" class="sum-sec" data-testid="traveller-satisfaction">
    <!-- "Preference match", not "satisfaction": the number is a keyword match
         between what each traveller asked for and what the itinerary contains. -->
    <h4>Preference match</h4>

    <div v-for="row in rows" :key="row.travellerId" class="q-row" data-testid="traveller-satisfaction-row">
      <div class="qt">
        <span class="who">{{ row.label }}</span><b>{{ row.pct }}%</b>
      </div>
      <div class="qbar"><div class="f" :class="{ veto: row.vetoedBy?.length }" :style="{ width: row.pct + '%' }" /></div>
      <div v-if="row.vetoedBy?.length" class="vetoes">
        <span v-for="term in row.vetoedBy" :key="term" class="veto-chip" data-testid="veto-chip">{{ term }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.sum-sec { padding: var(--s-5) var(--s-5); border-bottom: var(--hair); }
.sum-sec h4 { margin: 0 0 var(--s-4); font-family: var(--mono); font-size: var(--t-12); color: var(--fg-3); text-transform: uppercase; letter-spacing: .1em; font-weight: 500; }
.q-row { margin-bottom: var(--s-3); }
.q-row .qt { display: flex; justify-content: space-between; font-size: var(--t-14); margin-bottom: 5px; gap: var(--s-3); }
.q-row .qt .who { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.q-row .qt b { font-family: var(--mono); color: var(--green); }
.q-row .qbar { height: 5px; background: var(--bg-3); border: var(--hair-soft); position: relative; }
.q-row .qbar .f { position: absolute; left: 0; top: 0; bottom: 0; background: var(--green); }
.q-row .qbar .f.veto { background: var(--red, #c0392b); }
.vetoes { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 5px; }
.veto-chip { font-family: var(--mono); font-size: var(--t-12); color: var(--fg-3); border: var(--hair-soft); padding: 1px 5px; }
</style>

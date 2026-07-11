<script setup lang="ts">
const props = defineProps<{
  fairnessScore: number | null
  satisfactionScore: number | null
  constraintsPassed: boolean | null
  timingConflicts: number
  rounds: number | null
}>()
</script>

<template>
  <div class="sum-sec">
    <h4>Negotiation quality</h4>

    <div v-if="props.fairnessScore !== null" class="q-row">
      <div class="qt"><span>Fairness</span><b>{{ Math.round(props.fairnessScore) }}%</b></div>
      <div class="qbar"><div class="f" :style="{ width: Math.round(props.fairnessScore) + '%' }" /></div>
    </div>
    <div v-if="props.satisfactionScore !== null" class="q-row">
      <div class="qt"><span>Satisfaction</span><b>{{ Math.round(props.satisfactionScore) }}%</b></div>
      <div class="qbar"><div class="f" :style="{ width: Math.round(props.satisfactionScore) + '%' }" /></div>
    </div>

    <div v-if="props.constraintsPassed !== null" class="q-meta">
      <span>Constraints</span>
      <span class="v" :class="{ ok: props.constraintsPassed }">{{ props.constraintsPassed ? '✓ passed' : '✗ failed' }}</span>
    </div>
    <div class="q-meta">
      <span>Timing conflicts</span>
      <span class="v" :class="{ ok: props.timingConflicts === 0 }">{{ props.timingConflicts }} detected</span>
    </div>
    <div v-if="props.rounds !== null" class="q-meta">
      <span>Negotiation rounds</span>
      <span class="v">{{ props.rounds }}</span>
    </div>
  </div>
</template>

<style scoped>
.sum-sec { padding: var(--s-5) var(--s-5); border-bottom: var(--hair); }
.sum-sec h4 { margin: 0 0 var(--s-4); font-family: var(--mono); font-size: var(--t-12); color: var(--fg-3); text-transform: uppercase; letter-spacing: .1em; font-weight: 500; }
.q-row { margin-bottom: var(--s-3); }
.q-row .qt { display: flex; justify-content: space-between; font-size: var(--t-14); margin-bottom: 5px; }
.q-row .qt b { font-family: var(--mono); color: var(--green); }
.q-row .qbar { height: 5px; background: var(--bg-3); border: var(--hair-soft); position: relative; }
.q-row .qbar .f { position: absolute; left: 0; top: 0; bottom: 0; background: var(--green); }
.q-meta { display: flex; justify-content: space-between; font-family: var(--mono); font-size: var(--t-12); color: var(--fg-3); padding: 6px 0; border-top: var(--hair-soft); }
.q-meta .v { color: var(--fg-1); }
.q-meta .v.ok { color: var(--green); }
</style>

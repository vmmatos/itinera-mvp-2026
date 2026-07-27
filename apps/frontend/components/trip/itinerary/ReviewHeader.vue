<script setup lang="ts">
const props = defineProps<{
  title: string
  meta: string
  priceMode: 'pp' | 'total'
}>()

const emit = defineEmits<{
  'update:priceMode': [mode: 'pp' | 'total']
  refine: []
  accept: []
  reject: []
  'toggle-summary': []
}>()
</script>

<template>
  <div class="rhead">
    <div class="lhs">
      <div class="eb">Proposed itinerary · committed</div>
      <h1>{{ props.title }} <em>{{ props.meta }}</em></h1>
    </div>
    <div class="rhs">
      <button class="btn sum-toggle" data-testid="summary-toggle" @click="emit('toggle-summary')">Trip summary</button>
      <div class="seg" data-testid="price-toggle">
        <button :class="{ on: props.priceMode === 'pp' }" @click="emit('update:priceMode', 'pp')">per person</button>
        <button :class="{ on: props.priceMode === 'total' }" @click="emit('update:priceMode', 'total')">total</button>
      </div>
      <button class="btn cancel-link" data-testid="cancel-trip" @click="emit('reject')">Cancel trip</button>
      <button class="btn" data-testid="refine-btn" @click="emit('refine')">Re-run</button>
      <button class="btn btn-primary" data-testid="continue-btn" @click="emit('accept')">Continue →</button>
    </div>
  </div>
</template>

<style scoped>
.rhead { display: flex; align-items: center; justify-content: space-between; gap: var(--s-4); padding: var(--s-4) var(--s-6); border-bottom: var(--hair-soft); flex-shrink: 0; flex-wrap: wrap; }
.lhs .eb { font-family: var(--mono); font-size: var(--t-12); color: var(--green); text-transform: uppercase; letter-spacing: .1em; }
.lhs h1 { margin: 2px 0 0; font-size: var(--t-28); font-weight: 400; letter-spacing: -0.025em; }
.lhs h1 em { color: var(--fg-3); font-style: normal; font-size: var(--t-15); font-family: var(--mono); margin-left: var(--s-3); letter-spacing: 0; }
.rhs { display: flex; align-items: center; gap: var(--s-2); }
.seg { display: flex; border: var(--hair); background: var(--bg-2); }
.seg button { padding: 7px var(--s-3); font-family: var(--mono); font-size: var(--t-12); text-transform: uppercase; letter-spacing: .06em; color: var(--fg-3); background: none; border: none; cursor: pointer; }
.seg button.on { background: var(--bg-0); color: var(--fg-0); box-shadow: inset 0 0 0 1px var(--line-3); }
.cancel-link { color: var(--fg-3); font-size: var(--t-12); border-color: transparent; background: none; }
.cancel-link:hover { color: var(--red); background: none; border-color: transparent; }
.sum-toggle { display: none; height: 30px; }
@media (max-width: 1080px) {
  .sum-toggle { display: inline-flex; }
}
</style>

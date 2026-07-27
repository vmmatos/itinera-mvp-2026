<script setup lang="ts">
import { computed } from 'vue'
import type { BudgetBreakdown } from '~/types/index'
import { budgetCategoriesToRows, formatMoney } from '~/utils/itineraryViewModel'

const props = defineProps<{
  budgetBreakdown: BudgetBreakdown | null
  priceMode: 'pp' | 'total'
  travellers: number
  currencySymbol: string
}>()

const rows = computed(() => budgetCategoriesToRows(props.budgetBreakdown))
const maxAmount = computed(() => Math.max(1, ...rows.value.map((r) => r.amountPerPerson)))

const otherModeLabel = computed(() => {
  const bd = props.budgetBreakdown
  if (!bd) return ''
  return props.priceMode === 'pp'
    ? `${formatMoney(bd.perPersonTotal, 'total', props.travellers, props.currencySymbol)} total · ${props.travellers} travellers`
    : `${formatMoney(bd.perPersonTotal, 'pp', props.travellers, props.currencySymbol)} / person · ${props.travellers} travellers`
})
</script>

<template>
  <div class="sum-sec">
    <h4>
      Final price
      <span v-if="props.budgetBreakdown" class="st" :class="{ over: props.budgetBreakdown.status === 'over_budget' }" data-testid="budget-badge">
        {{ props.budgetBreakdown.status === 'within_budget' ? '✓ within budget' : '⚠ over budget' }}
      </span>
    </h4>

    <template v-if="props.budgetBreakdown">
      <div class="cost-hero">
        <span class="big" data-testid="cost-hero">
          {{ formatMoney(props.budgetBreakdown.perPersonTotal, props.priceMode, props.travellers, props.currencySymbol) }}
        </span>
        <span class="unit">{{ props.priceMode === 'pp' ? '/ person' : 'total' }}</span>
      </div>
      <div class="cost-sub">{{ otherModeLabel }}</div>

      <div v-if="props.budgetBreakdown.currencyMismatch" class="mismatch-warning">
        ⚠️ Trip budget is in {{ props.budgetBreakdown.currency }}; real prices below are computed in EUR.
      </div>

      <div class="budget-bar">
        <div class="f" :style="{ width: Math.min(100, props.budgetBreakdown.percentageUsed) + '%' }" />
        <div class="ceil" style="left:100%" />
      </div>
      <div class="budget-legend">
        <span>used <b>{{ props.budgetBreakdown.percentageUsed }}%</b> of {{ formatMoney(props.budgetBreakdown.budgetTotal, 'pp', props.travellers, props.currencySymbol) }}</span>
        <span>{{ formatMoney(Math.max(0, props.budgetBreakdown.budgetTotal - props.budgetBreakdown.perPersonTotal), 'pp', props.travellers, props.currencySymbol) }} left / person</span>
      </div>

      <div v-for="row in rows" :key="row.key" class="cat" data-testid="category-row">
        <span class="nm"><span class="sw" :style="{ background: row.color }" />{{ row.label }}<span v-if="row.isEstimate" title="Estimate — real price unavailable">⚠️</span></span>
        <span class="amt">{{ formatMoney(row.amountPerPerson, props.priceMode, props.travellers, props.currencySymbol) }} <small>{{ props.priceMode === 'pp' ? '/pp' : 'total' }}</small></span>
        <div class="track"><div class="f" :style="{ width: (row.amountPerPerson / maxAmount * 100) + '%', background: row.color }" /></div>
      </div>
      <div class="cat total">
        <span class="nm">Total</span>
        <span class="amt">{{ formatMoney(props.budgetBreakdown.perPersonTotal, props.priceMode, props.travellers, props.currencySymbol) }} <small>{{ props.priceMode === 'pp' ? '/pp' : 'total' }}</small></span>
      </div>
    </template>
    <p v-else class="empty">Budget breakdown not available yet.</p>
  </div>
</template>

<style scoped>
.sum-sec { padding: var(--s-5) var(--s-5); border-bottom: var(--hair); }
.sum-sec h4 { margin: 0 0 var(--s-4); font-family: var(--mono); font-size: var(--t-12); color: var(--fg-3); text-transform: uppercase; letter-spacing: .1em; font-weight: 500; display: flex; justify-content: space-between; align-items: center; }
.sum-sec h4 .st { font-family: var(--mono); font-size: 10px; padding: 2px 7px; border: 1px solid var(--green-line); color: var(--green); background: var(--green-bg); }
.sum-sec h4 .st.over { border-color: var(--amber-line); color: var(--amber); background: var(--amber-bg); }
.cost-hero { display: flex; align-items: baseline; gap: var(--s-2); margin-bottom: 4px; }
.cost-hero .big { font-family: var(--mono); font-size: 34px; font-weight: 300; letter-spacing: -0.02em; }
.cost-hero .unit { font-family: var(--mono); font-size: var(--t-13); color: var(--fg-3); }
.cost-sub { font-family: var(--mono); font-size: var(--t-12); color: var(--fg-3); margin-bottom: var(--s-4); }
.mismatch-warning { font-size: var(--t-12); color: var(--amber); margin-bottom: var(--s-3); }
.budget-bar { height: 8px; background: var(--bg-3); border: var(--hair-soft); position: relative; margin-bottom: 6px; }
.budget-bar .f { position: absolute; left: 0; top: 0; bottom: 0; background: var(--green); }
.budget-bar .ceil { position: absolute; top: -3px; bottom: -3px; width: 2px; background: var(--fg-2); }
.budget-legend { display: flex; justify-content: space-between; font-family: var(--mono); font-size: 10px; color: var(--fg-3); margin-bottom: var(--s-4); }
.budget-legend b { color: var(--green); }
.cat { display: grid; grid-template-columns: 1fr auto; gap: 4px var(--s-3); align-items: center; padding: var(--s-2) 0; border-top: var(--hair-soft); }
.cat .nm { font-family: var(--mono); font-size: var(--t-13); color: var(--fg-2); text-transform: uppercase; letter-spacing: .04em; display: flex; align-items: center; gap: 7px; }
.cat .nm .sw { width: 9px; height: 9px; flex-shrink: 0; }
.cat .amt { font-family: var(--mono); font-size: var(--t-14); color: var(--fg-0); text-align: right; }
.cat .amt small { color: var(--fg-3); font-size: var(--t-12); }
.cat .track { grid-column: 1 / 3; height: 3px; background: var(--bg-3); position: relative; }
.cat .track .f { position: absolute; left: 0; top: 0; bottom: 0; }
.cat.total { border-top: var(--hair); margin-top: 4px; padding-top: var(--s-3); }
.cat.total .nm { color: var(--fg-0); font-size: var(--t-14); }
.cat.total .amt { font-size: var(--t-16); }
.empty { color: var(--fg-3); font-family: var(--mono); font-size: var(--t-13); }
</style>

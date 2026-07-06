<script setup lang="ts">
import { computed } from 'vue'
import type { BudgetBreakdown, BudgetCategory } from '~/types/index'

const props = withDefaults(defineProps<{
  breakdown: BudgetBreakdown
}>(), {})

const CATEGORY_LABEL: Record<BudgetCategory, string> = {
  accommodation: 'Accommodation',
  restaurants:   'Restaurants',
  activities:    'Activities',
  transport:     'Transport',
  buffer:        'Buffer (10%)',
}

const CATEGORY_ORDER: BudgetCategory[] = ['accommodation', 'restaurants', 'activities', 'transport', 'buffer']

const rows = computed(() =>
  CATEGORY_ORDER.map((category) => ({ category, label: CATEGORY_LABEL[category], detail: props.breakdown.categories[category] })),
)

function fmt(amount: number): string {
  return `${props.breakdown.currency === 'EUR' ? '€' : props.breakdown.currency + ' '}${amount.toLocaleString()}`
}
</script>

<template>
  <div class="summary-card" style="margin-bottom:var(--s-4)">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--s-3)">
      <div class="sub" style="margin:0">Budget breakdown</div>
      <span
        style="font-family:var(--mono);font-size:10px;text-transform:uppercase;letter-spacing:.06em;padding:3px 10px;border-radius:var(--r-1);font-weight:600"
        :style="breakdown.status === 'within_budget'
          ? 'background:rgba(0,255,136,0.08);color:var(--green);border:1px solid rgba(0,255,136,0.3)'
          : 'background:rgba(255,163,0,0.08);color:var(--amber);border:1px solid rgba(255,163,0,0.3)'"
      >{{ breakdown.status === 'within_budget' ? '✓ Within budget' : '⚠ Over budget' }}</span>
    </div>

    <div v-if="breakdown.currencyMismatch" style="font-size:var(--t-12);color:var(--amber);margin-bottom:var(--s-3)">
      ⚠️ Trip budget is in {{ breakdown.currency !== 'EUR' ? breakdown.currency : 'a non-EUR currency' }}; real prices below are computed in EUR.
    </div>

    <div class="kv" style="padding-top:var(--s-1)">
      <template v-for="row in rows" :key="row.category">
        <div class="k">
          {{ row.label }}
          <span v-if="row.detail.isEstimate" title="Real price unavailable — estimate shown">⚠️</span>
        </div>
        <div class="v mono">
          {{ fmt(row.detail.amountPerPerson) }}/person · {{ fmt(row.detail.amountTotal) }} total
        </div>
      </template>
    </div>

    <div style="display:flex;justify-content:space-between;align-items:center;padding-top:var(--s-3);margin-top:var(--s-3);border-top:var(--hair)">
      <span style="font-family:var(--mono);font-size:var(--t-12);color:var(--fg-2);text-transform:uppercase;letter-spacing:.06em">Total</span>
      <span style="font-family:var(--mono);font-size:var(--t-14);color:var(--fg-0);font-weight:600">
        {{ fmt(breakdown.perPersonTotal) }}/person · {{ fmt(breakdown.grandTotal) }} total
      </span>
    </div>
    <div style="font-size:var(--t-12);color:var(--fg-3);margin-top:4px">
      {{ breakdown.percentageUsed }}% of {{ fmt(breakdown.budgetTotal) }} budget · {{ breakdown.groupSize }} traveller(s)
    </div>

    <div v-if="breakdown.overruns.length > 0" style="margin-top:var(--s-4);padding-top:var(--s-3);border-top:var(--hair)">
      <div class="sub" style="margin-bottom:var(--s-2)">Over budget by category</div>
      <div class="kv">
        <template v-for="overrun in breakdown.overruns" :key="overrun.category">
          <div class="k">{{ CATEGORY_LABEL[overrun.category] }}</div>
          <div class="v mono" style="color:var(--amber)">+{{ fmt(overrun.overAmountTotal) }}</div>
        </template>
      </div>
    </div>

    <div v-if="breakdown.suggestedCuts.length > 0" class="suggest" style="margin-top:var(--s-4)">
      <h4>Suggested cuts</h4>
      <ul style="margin:var(--s-2) 0 0;padding-left:1.1em">
        <li v-for="(cut, i) in breakdown.suggestedCuts" :key="i" style="font-size:var(--t-12);margin-bottom:var(--s-1)">
          {{ cut.description }} — saves {{ fmt(cut.savingPerPerson) }}/person ({{ fmt(cut.savingTotal) }} total)
        </li>
      </ul>
    </div>
  </div>
</template>

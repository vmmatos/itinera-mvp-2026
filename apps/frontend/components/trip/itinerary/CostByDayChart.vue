<script setup lang="ts">
import { computed } from 'vue'
import type { DayVM } from '~/utils/itineraryV2'
import { dayCostMax } from '~/utils/itineraryV2'

const props = defineProps<{
  days: DayVM[]
  selectedDay: number
}>()

defineEmits<{ select: [index: number] }>()

const max = computed(() => dayCostMax(props.days))
</script>

<template>
  <div>
    <div class="daycost">
      <div
        v-for="day in props.days"
        :key="day.index"
        class="b"
        :class="{ sel: day.index === props.selectedDay }"
        :style="{ height: (day.costPerPerson / max * 100) + '%' }"
        data-testid="cost-bar"
        @click="$emit('select', day.index)"
      />
    </div>
    <div class="daycost-x">
      <span v-for="day in props.days" :key="day.index">D{{ day.day }}</span>
    </div>
    <p class="hint">estimate — activities, transport &amp; lodging; excludes buffer split precision</p>
  </div>
</template>

<style scoped>
.daycost { display: flex; align-items: flex-end; gap: 4px; height: 52px; margin-top: 6px; }
.daycost .b { flex: 1; background: var(--bg-3); border-top: 1px solid var(--line-3); position: relative; cursor: pointer; min-height: 4px; }
.daycost .b.sel { background: var(--green); border-color: var(--green); }
.daycost .b:hover { background: var(--line-3); }
.daycost .b.sel:hover { background: var(--green-dim); }
.daycost-x { display: flex; gap: 4px; margin-top: 4px; }
.daycost-x span { flex: 1; text-align: center; font-family: var(--mono); font-size: 9px; color: var(--fg-4); }
.hint { margin: var(--s-2) 0 0; font-family: var(--mono); font-size: 10px; color: var(--fg-4); }
</style>

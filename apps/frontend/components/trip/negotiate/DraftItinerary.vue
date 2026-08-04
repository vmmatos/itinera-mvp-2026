<script setup lang="ts">
import { computed, ref } from 'vue'
import type { DraftDay } from '~/types/index'
import { agentColorToken } from '~/utils/agentColorTokens'

const { t } = useI18n()

const props = defineProps<{
  days: DraftDay[]
  budgetTotal: number
  runningTotal: number
  filledCount: number
  totalSlots: number
}>()

const SLOT_KEYS = ['morning', 'afternoon', 'evening'] as const
const FALLBACK_REASON = (): string => t('trip.negotiate.draftItinerary.fallbackReason')

function dayFilledCount(day: DraftDay): number {
  return SLOT_KEYS.filter((k) => day.slots[k].status !== 'empty').length
}

const totalLabel = computed(() => `€${props.runningTotal.toLocaleString()}`)

const expanded = ref(new Set<string>())

function slotKey(day: DraftDay, key: string): string {
  return `${day.day}:${key}`
}

function isExpanded(day: DraftDay, key: string): boolean {
  return expanded.value.has(slotKey(day, key))
}

function toggleReason(day: DraftDay, key: string): void {
  const k = slotKey(day, key)
  const next = new Set(expanded.value)
  if (next.has(k)) next.delete(k)
  else next.add(k)
  expanded.value = next
}
</script>

<template>
  <div class="draft-itinerary-root" style="background:var(--bg-1);display:flex;flex-direction:column;min-height:0">
    <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 16px;border-bottom:var(--hair);min-height:40px" class="mono">
      <span style="font-size:11px;color:var(--fg-2);text-transform:uppercase;letter-spacing:.08em">{{ t('trip.negotiate.draftItinerary.title') }}</span>
      <span data-testid="slot-count" style="font-size:11px;color:var(--fg-2)">{{ t('trip.negotiate.draftItinerary.slotCount', { filled: filledCount, total: totalSlots }) }}</span>
    </div>
    <div style="flex:1;overflow-y:auto;padding:12px">
      <div v-for="day in days" :key="day.day" style="margin-bottom:14px" data-testid="draft-day">
        <div class="mono" style="display:flex;justify-content:space-between;align-items:baseline;font-size:11px;color:var(--fg-2);text-transform:uppercase;letter-spacing:.08em;padding-bottom:6px;border-bottom:1px solid var(--line-1);margin-bottom:6px">
          <span>D{{ day.day }} · {{ day.city }}</span>
          <span>{{ dayFilledCount(day) }}/3</span>
        </div>
        <div
          v-for="key in SLOT_KEYS"
          :key="key"
          data-testid="draft-slot"
          :data-status="day.slots[key].status"
          style="display:grid;grid-template-columns:58px 1fr;gap:10px;padding:7px 8px;border-bottom:1px dashed var(--line-1);align-items:center;min-height:44px"
        >
          <div class="mono" style="font-size:11px;color:var(--fg-3);text-transform:uppercase">{{ t(`trip.itinerary.daySlot.phase.${key}`) }}</div>
          <div v-if="day.slots[key].status === 'empty'" style="display:flex;align-items:center">
            <div class="skel skel-line" style="width:70%" />
          </div>
          <div v-else-if="day.slots[key].status === 'reserved'" data-testid="reserved-slot" style="opacity:.75">
            <div style="font-size:13px;color:var(--fg-1)">{{ day.slots[key].name }}</div>
            <div class="mono" style="font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--fg-3);margin-top:1px">
              {{ t('trip.negotiate.draftItinerary.reservedBy') }} <span :style="`color:${agentColorToken('logistics')}`">logistics</span>
            </div>
          </div>
          <div
            v-else
            data-testid="filled-slot"
            role="button"
            tabindex="0"
            style="cursor:pointer"
            @click="toggleReason(day, key)"
            @keydown.enter="toggleReason(day, key)"
            @keydown.space.prevent="toggleReason(day, key)"
          >
            <div style="font-size:13px;color:var(--fg-0)">{{ day.slots[key].name }}</div>
            <div class="mono" style="font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--fg-3);margin-top:1px">
              {{ t('trip.negotiate.draftItinerary.by') }} <span :style="`color:${agentColorToken(day.slots[key].color ?? 'neutral')}`">{{ day.slots[key].by }}</span> · {{ t('trip.negotiate.decisionEventCard.orchestrator') }} {{ day.slots[key].decisionStatus ?? t('trip.negotiate.draftItinerary.accepted') }}
            </div>
            <div
              v-if="isExpanded(day, key)"
              data-testid="slot-reason"
              style="margin-top:6px;font-size:12px;color:var(--fg-3);border-top:1px dashed var(--line-1);padding-top:6px"
            >
              {{ day.slots[key].reason ?? FALLBACK_REASON() }}
            </div>
          </div>
        </div>
      </div>
    </div>
    <div style="border-top:var(--hair);padding:12px 16px;display:flex;justify-content:space-between;align-items:baseline">
      <span class="mono helper">{{ t('trip.negotiate.draftItinerary.estTotalPp') }}</span>
      <span class="mono" style="font-size:20px;font-weight:300" data-testid="running-total">
        {{ totalLabel }}
        <small style="font-size:11px;color:var(--fg-3);margin-left:6px">{{ t('trip.negotiate.draftItinerary.budget', { amount: budgetTotal.toLocaleString() }) }}</small>
      </span>
    </div>
  </div>
</template>

<style scoped>
.draft-itinerary-root {
  border-left: var(--hair);
}
@media (max-width: 1180px) {
  .draft-itinerary-root {
    border-left: none;
    border-top: var(--hair);
  }
}
</style>

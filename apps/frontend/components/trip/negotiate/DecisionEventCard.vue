<script setup lang="ts">
import { computed } from 'vue'
import type { DecisionStreamEvent } from '~/types/index'
import { agentColorToken } from '~/utils/agentColorTokens'

const props = defineProps<{ event: DecisionStreamEvent }>()

const colorVar = computed(() => agentColorToken(props.event.color))
const isOrchestrator = computed(() => props.event.kind === 'workflow')

const chipLabel = computed(() => (props.event.chip === 'pending' ? 'awaiting orchestrator' : props.event.chip))
const chipColor = computed(() => {
  switch (props.event.chip) {
    case 'accepted':
    case 'applied':
      return { c: 'var(--green)', bg: 'var(--green-bg)', line: 'var(--green-line)' }
    case 'merged':
      return { c: 'var(--blue)', bg: 'var(--blue-bg)', line: 'var(--blue-line)' }
    case 'rejected':
      return { c: 'var(--red)', bg: 'rgba(255,93,93,0.07)', line: 'rgba(255,93,93,0.32)' }
    default:
      return { c: 'var(--fg-2)', bg: 'transparent', line: 'var(--line-3)' }
  }
})

const time = computed(() => {
  const d = new Date(props.event.timestamp)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
})
</script>

<template>
  <div
    data-testid="decision-event"
    :data-chip="event.chip"
    :style="`border:var(--hair);background:var(--bg-1);padding:10px 14px;${isOrchestrator ? 'border-left:2px solid var(--fg-1)' : ''}`"
  >
    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
      <span class="mono" style="font-size:12px;font-weight:600" :style="`color:${colorVar}`">{{ event.who }}</span>
      <span class="mono" style="font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:var(--fg-3)">{{ event.kind }}</span>
      <span
        class="mono"
        data-testid="chip"
        :style="`font-size:10px;text-transform:uppercase;letter-spacing:.08em;padding:2px 7px;border:1px solid ${chipColor.line};color:${chipColor.c};background:${chipColor.bg}`"
      >{{ chipLabel }}</span>
      <span class="mono" style="font-size:10px;color:var(--fg-4);margin-left:auto">{{ time }}</span>
    </div>
    <div style="margin-top:6px;font-size:13px;color:var(--fg-1)">{{ event.body }}</div>
    <div v-if="event.facts.length > 0" class="mono" style="display:flex;gap:14px;margin-top:8px;flex-wrap:wrap;font-size:11px;color:var(--fg-2)">
      <span v-for="[k, v] in event.facts" :key="k">{{ k }} <b style="color:var(--fg-0);font-weight:500">{{ v }}</b></span>
    </div>
    <div v-if="event.decisionReason" style="margin-top:6px;font-size:12px;color:var(--fg-3);border-top:1px dashed var(--line-1);padding-top:6px">
      <b style="color:var(--fg-2);font-weight:500">orchestrator</b> · {{ event.decisionReason }}
    </div>
  </div>
</template>

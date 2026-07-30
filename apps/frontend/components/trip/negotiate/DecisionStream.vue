<script setup lang="ts">
import { ref, watch, nextTick } from 'vue'
import type { DecisionStreamEvent } from '~/types/index'
import DecisionEventCard from './DecisionEventCard.vue'

const props = defineProps<{
  events: DecisionStreamEvent[]
  sessionStatus: 'negotiating' | 'complete'
}>()

const scrollEl = ref<HTMLElement | null>(null)

watch(
  () => props.events.length,
  async () => {
    await nextTick()
    if (scrollEl.value) scrollEl.value.scrollTop = scrollEl.value.scrollHeight
  },
)
</script>

<template>
  <div style="display:flex;flex-direction:column;min-height:0">
    <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 16px;border-bottom:var(--hair);min-height:40px" class="mono">
      <span style="font-size:11px;color:var(--fg-2);text-transform:uppercase;letter-spacing:.08em">decision stream · orchestrator + proposals</span>
      <span style="color:var(--green);display:flex;align-items:center;gap:6px;font-size:11px;text-transform:uppercase;letter-spacing:.08em">
        <span style="width:6px;height:6px;border-radius:50%;background:var(--lime);box-shadow:0 0 8px var(--lime)" class="pulse-green" />
        live
      </span>
    </div>
    <div ref="scrollEl" data-testid="decision-stream-scroll" style="flex:1;overflow-y:auto;padding:14px 18px;display:flex;flex-direction:column;gap:8px">
      <DecisionEventCard v-for="evt in events" :key="evt.id" :event="evt" />
      <div
        data-testid="stream-tail"
        :style="`display:flex;align-items:center;gap:10px;padding:10px 14px;border:1px dashed ${sessionStatus === 'complete' ? 'var(--green-line)' : 'var(--line-2)'};color:${sessionStatus === 'complete' ? 'var(--green)' : 'var(--fg-3)'};font-size:11px;text-transform:uppercase;letter-spacing:.08em`"
        class="mono"
      >
        <span v-if="sessionStatus !== 'complete'" style="width:10px;height:10px;border:1.5px solid var(--fg-3);border-top-color:transparent;border-radius:50%;display:inline-block;animation:spin .8s linear infinite" />
        <span>{{ sessionStatus === 'complete' ? 'session complete · itinerary committed' : 'orchestrator evaluating…' }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
@keyframes spin { to { transform: rotate(360deg); } }
</style>

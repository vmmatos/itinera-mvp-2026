<script setup lang="ts">
import { computed } from 'vue'
import type { StageInfo } from '~/types/index'

const props = defineProps<{ stages: StageInfo[] }>()

const currentStageIndex = computed(() => {
  const running = props.stages.findIndex((s) => s.status === 'running')
  if (running !== -1) return running
  const lastDone = [...props.stages].reverse().findIndex((s) => s.status === 'done')
  return lastDone === -1 ? -1 : props.stages.length - 1 - lastDone
})

const stageLabel = computed(() => {
  if (currentStageIndex.value === -1) return 'initialising…'
  const stage = props.stages[currentStageIndex.value]
  return `stage ${currentStageIndex.value + 1} of ${props.stages.length} · ${stage?.label ?? ''}`
})
</script>

<template>
  <div style="border-bottom:var(--hair);background:var(--bg-1);padding:16px 20px 18px">
    <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:14px;gap:12px;flex-wrap:wrap">
      <h1 style="margin:0;font-size:22px;font-weight:400;letter-spacing:-0.02em">
        Agents are building your itinerary
        <span style="color:var(--fg-3);font-weight:300"> · orchestrator in control</span>
      </h1>
      <span class="helper" data-testid="stage-label">{{ stageLabel }}</span>
    </div>

    <div class="max-[1180px]:grid-cols-3 max-[820px]:grid-cols-2" style="display:grid;grid-template-columns:repeat(6,1fr);gap:6px">
      <div
        v-for="stage in stages"
        :key="stage.id"
        data-testid="stage-cell"
        :data-status="stage.status"
        :style="`border:1px solid ${stage.status === 'running' ? 'var(--green-line)' : stage.status === 'done' ? 'var(--line-3)' : 'var(--line-2)'};background:${stage.status === 'running' ? 'var(--green-bg)' : 'var(--bg-2)'};padding:10px 12px;min-width:0`"
      >
        <div
          class="mono"
          style="font-size:11px;text-transform:uppercase;letter-spacing:.06em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis"
          :style="`color:${stage.status === 'done' ? 'var(--fg-1)' : stage.status === 'running' ? 'var(--fg-0)' : 'var(--fg-2)'}`"
        >{{ stage.label }}</div>
        <div
          class="mono"
          style="display:flex;align-items:center;gap:7px;margin-top:6px;font-size:10px;text-transform:uppercase;letter-spacing:.08em"
          :style="`color:${stage.status === 'done' ? 'var(--green)' : stage.status === 'running' ? 'var(--green)' : 'var(--fg-3)'}`"
        >
          <span v-if="stage.status === 'running'" style="width:8px;height:8px;border:1.5px solid var(--green);border-top-color:transparent;border-radius:50%;display:inline-block;animation:spin .8s linear infinite" />
          <span v-else-if="stage.status === 'done'">✓</span>
          <span v-else>·</span>
          <span>{{ stage.status === 'running' ? 'running' : stage.status === 'done' ? 'done' : 'queued' }}</span>
        </div>
        <div style="height:2px;background:var(--bg-3);margin-top:8px;position:relative;overflow:hidden">
          <div
            v-if="stage.status === 'done'"
            style="position:absolute;inset:0;background:var(--lime)"
          />
          <div
            v-else-if="stage.status === 'running'"
            style="position:absolute;top:0;bottom:0;left:-40%;width:40%;background:var(--lime);animation:indet 1.6s ease-in-out infinite"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
@keyframes spin { to { transform: rotate(360deg); } }
@keyframes indet {
  0%   { left: -40%; width: 40%; }
  50%  { left: 30%;  width: 40%; }
  100% { left: 100%; width: 40%; }
}
</style>

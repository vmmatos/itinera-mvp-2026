<script setup lang="ts">
import { computed } from 'vue'
import type { AgentCardState } from '~/types/index'
import AgentCard from './AgentCard.vue'

const { t } = useI18n()

const props = defineProps<{ agents: AgentCardState[] }>()

const busyCount = computed(() => props.agents.filter((a) => a.state !== 'idle').length)
</script>

<template>
  <div class="max-[820px]:border-r-0 max-[820px]:border-b" style="border-right:var(--hair);display:flex;flex-direction:column;min-height:0">
    <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 16px;border-bottom:var(--hair);min-height:40px" class="mono">
      <span style="font-size:11px;color:var(--fg-2);text-transform:uppercase;letter-spacing:.08em">{{ t('trip.negotiate.agentList.title') }}</span>
      <span data-testid="agent-summary" style="font-size:11px;color:var(--fg-2)">{{ t('trip.negotiate.agentList.busy', { count: busyCount, total: agents.length }) }}</span>
    </div>
    <div class="max-[820px]:flex-row max-[820px]:overflow-x-auto" style="display:flex;flex-direction:column;padding:10px;gap:8px;overflow-y:auto;min-height:0">
      <AgentCard v-for="agent in agents" :key="agent.id" :agent="agent" class="max-[820px]:min-w-[190px] max-[820px]:shrink-0" />
    </div>
  </div>
</template>

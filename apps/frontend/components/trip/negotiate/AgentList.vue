<script setup lang="ts">
import { computed } from 'vue'
import type { AgentCardState } from '~/types/index'
import AgentCard from './AgentCard.vue'

const { t } = useI18n()

const props = defineProps<{ agents: AgentCardState[] }>()

const busyCount = computed(() => props.agents.filter((a) => a.state !== 'idle').length)
</script>

<template>
  <div class="agent-list-root" style="display:flex;flex-direction:column;min-height:0">
    <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 16px;border-bottom:var(--hair);min-height:40px" class="mono">
      <span style="font-size:11px;color:var(--fg-2);text-transform:uppercase;letter-spacing:.08em">{{ t('trip.negotiate.agentList.title') }}</span>
      <span data-testid="agent-summary" style="font-size:11px;color:var(--fg-2)">{{ t('trip.negotiate.agentList.busy', { count: busyCount, total: agents.length }) }}</span>
    </div>
    <div class="agent-list-cards" style="padding:10px;gap:8px;min-height:0">
      <AgentCard v-for="agent in agents" :key="agent.id" :agent="agent" class="agent-card-item" />
    </div>
  </div>
</template>

<style scoped>
.agent-list-root {
  border-right: var(--hair);
}
.agent-list-cards {
  display: flex;
  flex-direction: column;
  overflow-y: auto;
}

@media (max-width: 820px) {
  .agent-list-root {
    border-right: none;
    border-bottom: var(--hair);
  }
  .agent-list-cards {
    flex-direction: row;
    overflow-x: auto;
    overflow-y: visible;
    -webkit-overflow-scrolling: touch;
  }
  .agent-list-cards > :deep(.agent-card-item) {
    min-width: 190px;
    flex-shrink: 0;
  }
}
</style>

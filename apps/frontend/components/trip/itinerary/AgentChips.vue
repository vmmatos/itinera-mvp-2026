<script setup lang="ts">
import { agentColorToken } from '~/utils/agentColorTokens'
import { AGENT_COLOURS, type AgentName } from '~/types/index'

const { t } = useI18n()

const props = defineProps<{
  agentNames: string[]
}>()

function colorFor(name: string): string {
  const colour = AGENT_COLOURS[name as AgentName]
  return agentColorToken(colour ?? 'neutral')
}
</script>

<template>
  <div class="sum-sec">
    <h4>{{ t('trip.itinerary.agentChips.title') }}</h4>
    <div class="agents">
      <span
        v-for="name in props.agentNames"
        :key="name"
        class="ab"
        :style="{ borderColor: colorFor(name), color: colorFor(name) }"
        data-testid="agent-chip"
      >{{ name }}</span>
    </div>
  </div>
</template>

<style scoped>
.sum-sec { padding: var(--s-5) var(--s-5); border-bottom: var(--hair); }
.sum-sec h4 { margin: 0 0 var(--s-4); font-family: var(--mono); font-size: var(--t-12); color: var(--fg-3); text-transform: uppercase; letter-spacing: .1em; font-weight: 500; }
.agents { display: flex; flex-wrap: wrap; gap: 6px; }
.ab { font-family: var(--mono); font-size: var(--t-12); padding: 3px 9px; border: 1px solid var(--line-2); }
</style>

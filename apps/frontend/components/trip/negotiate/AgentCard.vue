<script setup lang="ts">
import { computed } from 'vue'
import type { AgentCardState } from '~/types/index'
import { agentColorToken } from '~/utils/agentColorTokens'

const { t } = useI18n()

const props = defineProps<{ agent: AgentCardState }>()

const colorVar = computed(() => agentColorToken(props.agent.color))
const busy = computed(() => props.agent.state !== 'idle')
</script>

<template>
  <div
    data-testid="agent-card"
    :data-state="agent.state"
    :style="`border:1px solid ${busy ? 'var(--line-3)' : 'var(--line-2)'};background:${busy ? 'var(--bg-2)' : 'var(--bg-1)'};padding:12px;position:relative`"
  >
    <div style="display:flex;align-items:center;gap:8px">
      <span
        :class="busy ? 'agent-thinking-dot' : ''"
        :style="`width:8px;height:8px;border-radius:50%;flex-shrink:0;background:${colorVar}`"
      />
      <span class="mono" style="font-size:13px;font-weight:600" :style="`color:${colorVar}`">{{ agent.id }}</span>
      <span class="mono" style="font-size:10px;color:var(--fg-3);text-transform:uppercase;letter-spacing:.06em;margin-left:auto">{{ agent.role }}</span>
    </div>
    <div class="mono" style="margin-top:8px;display:flex;align-items:center;gap:8px;font-size:11px;color:var(--fg-2);min-height:16px">
      <template v-if="agent.state === 'thinking'">
        <span style="width:9px;height:9px;border:1.5px solid currentColor;border-top-color:transparent;border-radius:50%;display:inline-block;animation:spin .8s linear infinite" />
        <span>{{ t('trip.negotiate.agentCard.thinking') }}</span>
      </template>
      <template v-else-if="agent.state === 'proposing'">
        <span style="width:9px;height:9px;border:1.5px solid currentColor;border-top-color:transparent;border-radius:50%;display:inline-block;animation:spin .8s linear infinite" />
        <span>{{ t('trip.negotiate.agentCard.proposing') }}</span>
      </template>
      <span v-else style="color:var(--fg-3)">{{ t('trip.negotiate.agentCard.idle') }}</span>
    </div>
    <div style="margin-top:6px;font-size:12px;color:var(--fg-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
      {{ agent.lastAction ?? '—' }}
    </div>
  </div>
</template>

<style scoped>
@keyframes spin { to { transform: rotate(360deg); } }
</style>

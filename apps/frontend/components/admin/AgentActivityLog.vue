<script setup lang="ts">
import { ref, computed } from 'vue'
import type { AgentLogEntry, AgentStreamEvent } from '~/types/index'
import { AGENT_COLOURS } from '~/types/index'

const { t } = useI18n()

const props = defineProps<{
  agentLogs: AgentLogEntry[]
  liveEvents: AgentStreamEvent[]
}>()

type AgentFilter = 'all' | 'alice' | 'bob' | 'carlos' | 'diana' | 'orchestrator' | 'finance' | 'logistics' | 'validator' | 'sys'

const collapsed = ref(false)
const activeFilter = ref<AgentFilter>('all')

const COLOUR_CODE: Record<string, string> = {
  green:   'g',
  amber:   'a',
  blue:    'b',
  magenta: 'm',
}

function colourCode(agent: string): string {
  const colour = AGENT_COLOURS[agent as keyof typeof AGENT_COLOURS] ?? 'green'
  return COLOUR_CODE[colour] ?? 's'
}

function formatTs(iso: string): string {
  try {
    const d = new Date(iso)
    const hh = String(d.getHours()).padStart(2, '0')
    const mm = String(d.getMinutes()).padStart(2, '0')
    const ss = String(d.getSeconds()).padStart(2, '0')
    const ms = String(d.getMilliseconds()).padStart(3, '0')
    return `${hh}:${mm}:${ss}.${ms}`
  } catch { return '—' }
}

interface LogLine {
  id: string
  ts: string
  level: string
  agent: string
  msg: string
  latencyMs?: number
  tokensUsed?: number
  colourCode: string
}

const allLines = computed((): LogLine[] => {
  const fromDb: LogLine[] = props.agentLogs.map((l) => ({
    id: l.id,
    ts: formatTs(l.createdAt),
    level: l.action,
    agent: l.agent,
    msg: l.reasoning ?? `${l.action} · round ${l.round}`,
    latencyMs: l.latencyMs,
    tokensUsed: l.tokensUsed,
    colourCode: colourCode(l.agent),
  }))

  const fromSSE: LogLine[] = props.liveEvents.map((ev, i) => ({
    id: `sse-${i}-${ev.timestamp}`,
    ts: formatTs(ev.timestamp),
    level: ev.type,
    agent: ev.agent,
    msg: ev.metrics
      ? `${ev.type} · r${ev.round} · ${ev.metrics.latencyMs}ms · ${ev.metrics.tokensUsed}tok`
      : `${ev.type} · round ${ev.round}`,
    latencyMs: ev.metrics?.latencyMs,
    tokensUsed: ev.metrics?.tokensUsed,
    colourCode: colourCode(ev.agent),
  }))

  return [...fromSSE, ...fromDb].slice(0, 200)
})

const filtered = computed(() =>
  activeFilter.value === 'all'
    ? allLines.value
    : allLines.value.filter((l) => l.agent === activeFilter.value),
)

const filters: AgentFilter[] = ['all', 'alice', 'bob', 'carlos', 'diana', 'orchestrator', 'sys']
</script>

<template>
  <div class="alog" :class="{ collapsed }">
    <div class="alog-head">
      <div class="lhs">
        <button
          v-for="f in filters"
          :key="f"
          :class="['t', { on: activeFilter === f }]"
          type="button"
          @click="activeFilter = f"
        >{{ f }}</button>
      </div>
      <div class="rhs">
        <span class="badge">{{ t('admin.agentActivityLog.lines', { count: filtered.length }) }}</span>
        <button class="toggle-btn" type="button" @click="collapsed = !collapsed">
          {{ collapsed ? t('admin.agentActivityLog.expand') : t('admin.agentActivityLog.collapse') }}
        </button>
      </div>
    </div>

    <div v-if="!collapsed" class="alog-body">
      <div v-if="filtered.length === 0" class="empty-state">{{ t('admin.agentActivityLog.noEntries') }}</div>
      <div
        v-for="line in filtered"
        :key="line.id"
        class="al"
        :data-c="line.colourCode"
      >
        <span class="ts">{{ line.ts }}</span>
        <span :class="['lvl', line.level]">{{ line.level }}</span>
        <span class="ag">{{ line.agent }}</span>
        <span class="msg">
          {{ line.msg }}
          <span v-if="line.latencyMs" class="num"> · {{ line.latencyMs }}ms</span>
          <span v-if="line.tokensUsed" class="num"> · {{ line.tokensUsed }}tok</span>
        </span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.alog {
  border-top: var(--hair);
  background: var(--bg-0);
  flex-shrink: 0;
}
.alog-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0 var(--s-5);
  height: 36px;
  border-bottom: var(--hair);
}
.lhs { display: flex; gap: 0; }
.t {
  padding: 6px 10px;
  font-family: var(--mono);
  font-size: var(--t-12);
  text-transform: uppercase;
  letter-spacing: .06em;
  color: var(--fg-3);
  background: none;
  border: none;
  cursor: pointer;
}
.t.on { color: var(--fg-0); }
.rhs { display: flex; align-items: center; gap: var(--s-3); }
.badge {
  font-family: var(--mono);
  font-size: var(--t-11);
  color: var(--fg-3);
  background: var(--bg-2);
  border: var(--hair);
  padding: 2px 6px;
  text-transform: uppercase;
  letter-spacing: .06em;
}
.toggle-btn {
  font-family: var(--mono);
  font-size: var(--t-12);
  color: var(--fg-3);
  background: none;
  border: none;
  cursor: pointer;
}
.alog-body {
  height: 180px;
  overflow-y: auto;
  font-family: var(--mono);
  font-size: var(--t-12);
  line-height: 1.6;
}
.al {
  padding: 4px var(--s-5);
  border-bottom: 1px solid var(--bg-1);
  display: grid;
  grid-template-columns: 100px 70px 90px 1fr;
  gap: 8px;
  align-items: start;
}
.ts { color: var(--fg-3); }
.lvl { color: var(--fg-3); text-transform: uppercase; }
.lvl.propose { color: var(--blue); }
.lvl.accept { color: var(--green); }
.lvl.reject { color: var(--red, #ff5d5d); }
.lvl.refine { color: var(--amber); }
.ag { font-weight: 500; text-transform: uppercase; letter-spacing: .04em; }
.al[data-c="g"] .ag { color: var(--green); }
.al[data-c="a"] .ag { color: var(--amber); }
.al[data-c="b"] .ag { color: var(--blue); }
.al[data-c="m"] .ag { color: var(--magenta); }
.msg { color: var(--fg-2); }
.num { color: var(--green); }
.empty-state {
  padding: var(--s-4) var(--s-5);
  color: var(--fg-4);
  font-family: var(--mono);
  font-size: var(--t-12);
  text-transform: uppercase;
  letter-spacing: .08em;
}
</style>

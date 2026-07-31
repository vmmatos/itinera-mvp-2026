<script setup lang="ts">
import { computed } from 'vue'
import type { ProposalRound, AgentStreamEvent } from '~/types/index'
import { AGENT_COLOURS } from '~/types/index'

const props = defineProps<{
  proposals: ProposalRound[]
  liveEvents: AgentStreamEvent[]
  paused: boolean
}>()

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
    const mm = String(d.getMinutes()).padStart(2, '0')
    const ss = String(d.getSeconds()).padStart(2, '0')
    const ms = String(d.getMilliseconds()).slice(0, 1)
    return `${mm}:${ss}.${ms}`
  } catch { return '—' }
}

function eventSummary(event: AgentStreamEvent): string {
  if (typeof event.content === 'string') return event.content.slice(0, 80)
  if (event.content && typeof event.content === 'object') {
    const c = event.content as Record<string, unknown>
    if (typeof c.summary === 'string') return c.summary.slice(0, 80)
    if (typeof c.message === 'string') return c.message.slice(0, 80)
  }
  return `round ${event.round}`
}

function proposalSummary(p: ProposalRound): string {
  if (p.reasoning) return p.reasoning.slice(0, 100)
  if (typeof p.content === 'object' && p.content) {
    const c = p.content as Record<string, unknown>
    if (typeof c.summary === 'string') return c.summary.slice(0, 100)
  }
  return `round ${p.round} · ${p.action}`
}

const byRound = computed(() => {
  const map = new Map<number, ProposalRound[]>()
  for (const p of props.proposals) {
    const arr = map.get(p.round) ?? []
    arr.push(p)
    map.set(p.round, arr)
  }
  return [...map.entries()].sort((a, b) => b[0] - a[0])
})

const visibleEvents = computed(() =>
  props.paused ? [] : props.liveEvents.slice(0, 40),
)

const expandedRounds = ref<Set<number>>(new Set())

function toggleRound(round: number): void {
  if (expandedRounds.value.has(round)) {
    expandedRounds.value.delete(round)
  } else {
    expandedRounds.value.add(round)
  }
}
</script>

<template>
  <div class="acol left">
    <div class="acol-head">
      <span>agent activity · live feed</span>
      <span v-if="!paused" class="live">
        <span class="pulse" />
        {{ liveEvents.length }} events
      </span>
      <span v-else style="color: var(--amber); font-family: var(--mono); font-size: var(--t-12);">⏸ paused</span>
    </div>

    <div class="feed">
      <!-- Live SSE events (newest first) -->
      <template v-if="visibleEvents.length > 0">
        <div
          v-for="ev in visibleEvents"
          :key="`${ev.tripId}-${ev.round}-${ev.agent}-${ev.timestamp}`"
          class="fe cur"
          :data-c="colourCode(ev.agent)"
        >
          <span class="ts">{{ formatTs(ev.timestamp) }}</span>
          <span class="ag">{{ ev.agent }}</span>
          <span class="body">
            <span class="k">{{ ev.type }}</span>
            {{ eventSummary(ev) }}
          </span>
        </div>
        <div class="fe-divider">── db proposals ──</div>
      </template>

      <!-- Proposals grouped by round -->
      <template v-if="byRound.length > 0">
        <template v-for="[round, items] in byRound" :key="round">
          <div class="fe round-header" @click="toggleRound(round)">
            <span class="ts">r{{ round }}</span>
            <span class="ag" style="color: var(--fg-2);">{{ items.length }} agents</span>
            <span class="body" style="color: var(--fg-3);">
              {{ expandedRounds.has(round) ? '▾' : '▸' }} round {{ round }}
            </span>
          </div>
          <template v-if="expandedRounds.has(round)">
            <div
              v-for="p in items"
              :key="p.id"
              class="fe"
              :data-c="colourCode(p.agent)"
            >
              <span class="ts">{{ formatTs(p.createdAt) }}</span>
              <span class="ag">{{ p.agent }}</span>
              <span class="body">
                <span class="k">{{ p.action }}</span>
                {{ proposalSummary(p) }}
              </span>
            </div>
          </template>
        </template>
      </template>

      <div v-else-if="visibleEvents.length === 0" class="empty-state">
        no proposals yet
      </div>
    </div>
  </div>
</template>

<style scoped>
.acol {
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.acol.left { border-right: var(--hair); }
.acol-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--s-3) var(--s-5);
  border-bottom: var(--hair);
  font-family: var(--mono);
  font-size: var(--t-12);
  color: var(--fg-2);
  text-transform: uppercase;
  letter-spacing: .08em;
  flex-shrink: 0;
}
.live { color: var(--green); display: flex; align-items: center; gap: 6px; }
.pulse {
  width: 6px; height: 6px; border-radius: 50%;
  background: var(--lime);
  box-shadow: 0 0 8px var(--lime);
  animation: pulse 1.4s infinite;
}
.feed {
  flex: 1;
  overflow-y: auto;
  font-family: var(--mono);
  font-size: var(--t-13);
  line-height: 1.55;
}
.fe {
  padding: 8px var(--s-5);
  border-bottom: 1px dashed var(--line-1);
  display: grid;
  grid-template-columns: 54px 70px 1fr;
  gap: 8px;
}
.fe.round-header { cursor: pointer; background: var(--bg-2); }
.fe.round-header:hover { background: var(--bg-3); }
.fe.cur { background: var(--bg-2); }
.fe.cur .ts { color: var(--green); }
.ts { color: var(--fg-3); }
.ag { font-weight: 500; text-transform: uppercase; letter-spacing: .04em; }
.fe[data-c="g"] .ag { color: var(--green); }
.fe[data-c="a"] .ag { color: var(--amber); }
.fe[data-c="b"] .ag { color: var(--blue); }
.fe[data-c="m"] .ag { color: var(--magenta); }
.body { color: var(--fg-1); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.body .k { color: var(--fg-3); margin-right: 4px; }
.fe-divider {
  padding: 4px var(--s-5);
  font-family: var(--mono);
  font-size: var(--t-11);
  color: var(--fg-4);
  text-transform: uppercase;
  letter-spacing: .08em;
  border-bottom: 1px dashed var(--line-1);
}
.empty-state {
  padding: var(--s-6) var(--s-5);
  color: var(--fg-4);
  font-family: var(--mono);
  font-size: var(--t-12);
  text-transform: uppercase;
  letter-spacing: .08em;
}
</style>

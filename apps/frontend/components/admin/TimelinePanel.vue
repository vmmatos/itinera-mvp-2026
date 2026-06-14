<script setup lang="ts">
import { ref, computed } from 'vue'
import type { ProposalRound, AgentLogEntry } from '~/types/index'
import { AGENT_COLOURS } from '~/types/index'

const props = defineProps<{
  proposals: ProposalRound[]
  agentLogs: AgentLogEntry[]
  tripName: string
}>()

type Tab = 'timeline' | 'commits' | 'trace'

const activeTab = ref<Tab>('timeline')

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
    return new Date(iso).toLocaleTimeString('en-GB', { hour12: false })
  } catch { return '—' }
}

interface TimelineActivity {
  name:       string
  agent:      string
  colourCode: string
  timeSlot:   string
  left:       string
  width:      string
  city?:      string
  venue?:     string
}

interface TimelineDay {
  label: string
  city?:  string
  activities: TimelineActivity[]
}

const timelineDays = computed((): TimelineDay[] => {
  const accepted = props.proposals.filter(
    (p) => p.action === 'accept' || p.action === 'score',
  )
  if (accepted.length === 0) return []

  const dayMap = new Map<string, TimelineActivity[]>()
  for (const p of accepted) {
    if (!p.content || typeof p.content !== 'object') continue
    const c = p.content as Record<string, unknown>
    const itinerary = Array.isArray(c.itinerary)
      ? (c.itinerary as Record<string, unknown>[])
      : Array.isArray(c.days)
        ? (c.days as Record<string, unknown>[])
        : []
    for (const day of itinerary) {
      const label = String(day.date ?? day.title ?? (typeof day.day === 'number' ? `Day ${day.day}` : 'Day'))
      const dayCity = typeof day.city === 'string' && day.city.trim() ? day.city.trim() : undefined
      const activities = Array.isArray(day.activities) ? day.activities : []
      const existing = dayMap.get(label) ?? []
      for (const act of activities as Record<string, unknown>[]) {
        existing.push({
          name:       String(act.name ?? act.activity ?? 'Activity'),
          agent:      String(act.agent ?? act.ownerAgent ?? p.agent),
          colourCode: colourCode(String(act.agent ?? act.ownerAgent ?? p.agent)),
          timeSlot:   String(act.time ?? 'morning'),
          left:       '10%',
          width:      '30%',
          city:       typeof act.city === 'string' && act.city.trim() ? act.city.trim() : dayCity,
          venue:      typeof act.venue === 'string' && act.venue.trim() ? act.venue.trim() : undefined,
        })
      }
      dayMap.set(label, existing)
    }
  }

  return [...dayMap.entries()].slice(0, 7).map(([label, activities]) => ({
    label,
    city: activities[0]?.city,
    activities,
  }))
})

const HOURS_AM = ['06', '07', '08', '09', '10', '11', '12', '13', '14', '15', '16', '17']
const HOURS_PM = ['12', '13', '14', '15', '16', '17', '18', '19', '20', '21', '22', '23']

const commitLog = computed(() =>
  props.proposals
    .filter((p) => p.action === 'accept')
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
)

const traceLog = computed(() =>
  [...props.agentLogs].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  ),
)
</script>

<template>
  <div class="acol acenter">
    <div class="acenter-tabs">
      <button
        :class="['t', { on: activeTab === 'timeline' }]"
        type="button"
        @click="activeTab = 'timeline'"
      >annotated timeline</button>
      <button
        :class="['t', { on: activeTab === 'commits' }]"
        type="button"
        @click="activeTab = 'commits'"
      >commit log</button>
      <button
        :class="['t', { on: activeTab === 'trace' }]"
        type="button"
        @click="activeTab = 'trace'"
      >trace</button>
      <span class="spacer" />
      <span class="x">trip · <b>{{ tripName || '—' }}</b></span>
    </div>

    <!-- TIMELINE TAB -->
    <div v-if="activeTab === 'timeline'" class="atimeline">
      <div class="atl-head">
        <h2>{{ tripName }} · annotated</h2>
        <span class="meta">{{ proposals.length }} proposals · {{ agentLogs.length }} log entries</span>
      </div>

      <div v-if="timelineDays.length === 0" class="empty-state">
        no committed activities yet — waiting for accepted proposals
      </div>

      <div v-else class="atl-rows">
        <template v-for="day in timelineDays" :key="day.label">
          <div class="atl-row">
            <div class="lbl">
              {{ day.label }}<br>
              <small v-if="day.city" class="lbl-city">{{ day.city }}</small>
              <small v-else>AM</small>
            </div>
            <div class="atl-track">
              <div class="atl-hours">
                <div v-for="h in HOURS_AM" :key="h" class="h" :data-h="h" />
              </div>
              <div
                v-for="(act, i) in day.activities.filter(a => a.timeSlot.includes('morning') || a.timeSlot.includes('am'))"
                :key="i"
                class="atl-block"
                :data-c="act.colourCode"
                :style="{ left: act.left, width: act.width }"
              >
                <span class="own">{{ act.agent }}</span>
                <span class="nm">{{ act.name }}</span>
                <span v-if="act.venue" class="venue">{{ act.venue }}</span>
              </div>
            </div>
          </div>
          <div class="atl-row">
            <div class="lbl">
              {{ day.label }}<br><small>PM</small>
            </div>
            <div class="atl-track">
              <div class="atl-hours">
                <div v-for="h in HOURS_PM" :key="h" class="h" :data-h="h" />
              </div>
              <div
                v-for="(act, i) in day.activities.filter(a => !a.timeSlot.includes('morning') && !a.timeSlot.includes('am'))"
                :key="i"
                class="atl-block"
                :data-c="act.colourCode"
                :style="{ left: act.left, width: act.width }"
              >
                <span class="own">{{ act.agent }}</span>
                <span class="nm">{{ act.name }}</span>
                <span v-if="act.venue" class="venue">{{ act.venue }}</span>
              </div>
            </div>
          </div>
        </template>
      </div>
    </div>

    <!-- COMMIT LOG TAB -->
    <div v-else-if="activeTab === 'commits'" class="log-scroll">
      <div v-if="commitLog.length === 0" class="empty-state">no commits yet</div>
      <div
        v-for="p in commitLog"
        :key="p.id"
        class="log-row"
        :data-c="colourCode(p.agent)"
      >
        <span class="ts">{{ formatTs(p.createdAt) }}</span>
        <span class="lvl commit">commit</span>
        <span class="ag">{{ p.agent }}</span>
        <span class="msg">round {{ p.round }} · {{ p.action }}</span>
      </div>
    </div>

    <!-- TRACE TAB -->
    <div v-else-if="activeTab === 'trace'" class="log-scroll">
      <div v-if="traceLog.length === 0" class="empty-state">no trace entries yet</div>
      <div
        v-for="entry in traceLog"
        :key="entry.id"
        class="log-row"
        :data-c="colourCode(entry.agent)"
      >
        <span class="ts">{{ formatTs(entry.createdAt) }}</span>
        <span class="lvl eval">{{ entry.action }}</span>
        <span class="ag">{{ entry.agent }}</span>
        <span class="msg">
          r{{ entry.round }}
          <span v-if="entry.latencyMs" class="num"> · {{ entry.latencyMs }}ms</span>
          <span v-if="entry.tokensUsed" class="num"> · {{ entry.tokensUsed }}tok</span>
          <span v-if="entry.reasoning" class="reasoning"> — {{ entry.reasoning.slice(0, 60) }}</span>
        </span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.acol { display: flex; flex-direction: column; min-height: 0; }
.acenter { grid-template-rows: auto 1fr; }
.acenter-tabs {
  display: flex;
  border-bottom: var(--hair);
  padding: 0 var(--s-5);
  font-family: var(--mono);
  font-size: var(--t-12);
  text-transform: uppercase;
  letter-spacing: .08em;
  color: var(--fg-3);
  flex-shrink: 0;
}
.t {
  padding: var(--s-3) var(--s-4);
  border-bottom: 2px solid transparent;
  background: none;
  border-top: none;
  border-left: none;
  border-right: none;
  color: var(--fg-3);
  cursor: pointer;
  font-family: var(--mono);
  font-size: var(--t-12);
  text-transform: uppercase;
  letter-spacing: .08em;
}
.t.on { color: var(--fg-0); border-bottom-color: var(--green); }
.spacer { flex: 1; }
.x { padding: var(--s-3) var(--s-4); color: var(--fg-3); }
.x b { color: var(--fg-1); font-weight: 500; }

.atimeline {
  padding: var(--s-5);
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: var(--s-4);
  flex: 1;
}
.atl-head { display: flex; justify-content: space-between; align-items: flex-end; }
.atl-head h2 { margin: 0; font-size: var(--t-22); font-weight: 500; letter-spacing: -0.01em; }
.meta { font-family: var(--mono); font-size: var(--t-12); color: var(--fg-3); text-transform: uppercase; letter-spacing: .08em; }

.atl-rows { display: flex; flex-direction: column; border: var(--hair); background: var(--bg-1); }
.atl-row { display: grid; grid-template-columns: 80px 1fr; border-bottom: var(--hair-soft); min-height: 54px; }
.atl-row:last-child { border-bottom: none; }
.lbl {
  padding: var(--s-3);
  background: var(--bg-2);
  border-right: var(--hair-soft);
  font-family: var(--mono);
  font-size: var(--t-12);
  color: var(--fg-2);
  text-transform: uppercase;
  letter-spacing: .06em;
  display: flex;
  flex-direction: column;
  justify-content: center;
}
.lbl small { color: var(--fg-3); font-size: 10px; }
.lbl-city { color: var(--green); font-size: 9px; text-transform: uppercase; letter-spacing: .06em; }
.atl-track { position: relative; display: flex; align-items: center; overflow: hidden; }
.atl-hours {
  position: absolute; left: 0; right: 0; top: 0; bottom: 0;
  display: grid; grid-template-columns: repeat(12, 1fr); pointer-events: none;
}
.h { border-right: 1px dashed var(--line-1); position: relative; }
.h::before {
  content: attr(data-h);
  position: absolute; top: 2px; left: 4px;
  font-family: var(--mono); font-size: 9px; color: var(--fg-4);
  text-transform: uppercase; letter-spacing: .06em;
}
.atl-block {
  position: absolute; height: 32px; top: 50%; transform: translateY(-50%);
  display: flex; align-items: center; gap: 6px; padding: 0 8px;
  font-family: var(--mono); font-size: var(--t-12); color: var(--fg-0);
  border: 1px solid var(--line-3); background: var(--bg-3);
  overflow: hidden;
}
.atl-block .own { font-size: 9px; text-transform: uppercase; letter-spacing: .08em; color: var(--fg-3); }
.atl-block[data-c="g"] { border-color: var(--green-line); background: var(--green-bg); color: var(--green); }
.atl-block[data-c="g"] .own { color: var(--green); }
.atl-block[data-c="a"] { border-color: var(--amber-line); background: var(--amber-bg); color: var(--amber); }
.atl-block[data-c="a"] .own { color: var(--amber); }
.atl-block[data-c="b"] { border-color: var(--blue-line); background: var(--blue-bg); color: var(--blue); }
.atl-block[data-c="b"] .own { color: var(--blue); }
.atl-block[data-c="m"] { border-color: var(--magenta-line); background: var(--magenta-bg); color: var(--magenta); }
.atl-block[data-c="m"] .own { color: var(--magenta); }
.nm { color: var(--fg-0); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.venue { font-size: 9px; color: var(--fg-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }

/* commit + trace log */
.log-scroll { flex: 1; overflow-y: auto; font-family: var(--mono); font-size: var(--t-13); line-height: 1.55; }
.log-row {
  padding: 6px var(--s-5);
  border-bottom: 1px dashed var(--line-1);
  display: grid;
  grid-template-columns: 80px 70px 70px 1fr;
  gap: 8px;
  align-items: start;
}
.ts { color: var(--fg-3); }
.lvl { color: var(--fg-3); }
.lvl.commit { color: var(--green); }
.lvl.eval { color: var(--blue); }
.ag { font-weight: 500; text-transform: uppercase; letter-spacing: .04em; color: var(--fg-2); }
.log-row[data-c="g"] .ag { color: var(--green); }
.log-row[data-c="a"] .ag { color: var(--amber); }
.log-row[data-c="b"] .ag { color: var(--blue); }
.log-row[data-c="m"] .ag { color: var(--magenta); }
.msg { color: var(--fg-1); }
.num { color: var(--green); }
.reasoning { color: var(--fg-3); font-style: italic; }

.empty-state {
  padding: var(--s-6) var(--s-5);
  color: var(--fg-4);
  font-family: var(--mono);
  font-size: var(--t-12);
  text-transform: uppercase;
  letter-spacing: .08em;
}
</style>

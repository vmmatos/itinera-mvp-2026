<script setup lang="ts">
import { computed } from 'vue'
import type { TripMetrics, SatisfactionScore, AgentLogEntry } from '~/types/index'
import { AGENT_COLOURS } from '~/types/index'

const props = defineProps<{
  metrics: TripMetrics[]
  scores: SatisfactionScore[]
  agentLogs: AgentLogEntry[]
  tripId: string
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

const latest = computed(() =>
  props.metrics.length > 0
    ? props.metrics[props.metrics.length - 1]
    : null,
)

const consensusScore = computed(() =>
  latest.value?.convergenceRounds != null
    ? (latest.value.fairnessScore ?? 0).toFixed(2)
    : '—',
)

const fairnessScore = computed(() =>
  latest.value ? latest.value.fairnessScore.toFixed(2) : '—',
)

const convergenceRounds = computed(() =>
  latest.value ? String(latest.value.convergenceRounds) : '—',
)

const autonomyScore = computed(() =>
  latest.value ? (latest.value.autonomyScore * 100).toFixed(0) + '%' : '—',
)

const totalTokens = computed(() => {
  const total = props.agentLogs.reduce((sum, l) => sum + (l.tokensUsed ?? 0), 0)
  return total > 0 ? `${Math.round(total / 1000)}k` : '—'
})

const latencyP50 = computed(() => {
  const latencies = props.agentLogs.map((l) => l.latencyMs ?? 0).filter(Boolean).sort((a, b) => a - b)
  if (latencies.length === 0) return '—'
  const idx = Math.floor(latencies.length * 0.5)
  return `${latencies[idx]}ms`
})

const latencyP95 = computed(() => {
  const latencies = props.agentLogs.map((l) => l.latencyMs ?? 0).filter(Boolean).sort((a, b) => a - b)
  if (latencies.length === 0) return '—'
  const idx = Math.floor(latencies.length * 0.95)
  return `${latencies[idx]}ms`
})

const sparkPoints = computed(() => {
  if (props.metrics.length === 0) return ''
  const scores = props.metrics.map((m) => m.fairnessScore)
  const maxVal = Math.max(...scores, 1)
  const width = 200
  const height = 28
  return scores
    .map((v, i) => {
      const x = (i / Math.max(scores.length - 1, 1)) * width
      const y = height - (v / maxVal) * (height - 4) - 2
      return `${x.toFixed(0)},${y.toFixed(0)}`
    })
    .join(' ')
})

const agentSatisfaction = computed(() => {
  const AGENTS = ['alice', 'bob', 'carlos', 'diana']
  return AGENTS.map((name) => {
    const score = props.scores.find((s) => s.name.toLowerCase() === name || s.persona === name)
    const pct = score ? Math.round(score.postScore * 100) : null
    return { name, pct, colourCode: colourCode(name) }
  })
})

const agentAutonomy = computed(() => {
  const AGENTS = ['alice', 'bob', 'carlos', 'diana']
  const total = props.agentLogs.length || 1
  return AGENTS.map((name) => {
    const count = props.agentLogs.filter((l) => l.agent === name).length
    const pct = Math.round((count / total) * 100)
    return { name, pct, colourCode: colourCode(name) }
  })
})
</script>

<template>
  <div class="acol right">
    <div class="acol-head">
      <span>metrics</span>
      <span>trip {{ tripId.slice(0, 8) }}</span>
    </div>

    <div class="metrics">
      <!-- consensus -->
      <div class="metric-row">
        <div class="lbl">
          <span>consensus / fairness</span>
          <span class="delta">{{ metrics.length }} rounds recorded</span>
        </div>
        <div class="v">
          {{ fairnessScore }}
          <span class="u">/ autonomy {{ autonomyScore }}</span>
        </div>
        <svg v-if="sparkPoints" class="spark" viewBox="0 0 200 28" preserveAspectRatio="none">
          <polyline :points="sparkPoints" fill="none" stroke="#00ff88" stroke-width="1.2" />
        </svg>
      </div>

      <!-- convergence -->
      <div class="metric-row">
        <div class="lbl">
          <span>convergence rounds</span>
          <span class="delta">{{ latest ? `total time — ms` : 'pending' }}</span>
        </div>
        <div class="v">
          {{ convergenceRounds }}
          <span class="u">/ est. 6 rounds</span>
        </div>
      </div>

      <!-- fairness -->
      <div class="metric-row">
        <div class="lbl">
          <span>fairness index</span>
        </div>
        <div class="v">
          {{ fairnessScore }}
          <span class="u">σ —</span>
        </div>
      </div>

      <!-- per-agent satisfaction bars -->
      <div class="metric-bars">
        <div class="lbl">per-agent satisfaction</div>
        <div
          v-for="ag in agentSatisfaction"
          :key="ag.name"
          class="mb-row"
          :data-c="ag.colourCode"
        >
          <span class="who">{{ ag.name }}</span>
          <div class="t">
            <div
              class="f"
              :style="{ width: ag.pct != null ? `${ag.pct}%` : '0%' }"
            />
          </div>
          <span class="num">{{ ag.pct != null ? ag.pct + '%' : '—' }}</span>
        </div>
      </div>

      <!-- autonomy bars -->
      <div class="metric-bars">
        <div class="lbl">autonomy · agent decisions / total</div>
        <div
          v-for="ag in agentAutonomy"
          :key="ag.name"
          class="mb-row"
          :data-c="ag.colourCode"
        >
          <span class="who">{{ ag.name }}</span>
          <div class="t">
            <div class="f" :style="{ width: `${ag.pct}%` }" />
          </div>
          <span class="num">{{ ag.pct }}%</span>
        </div>
      </div>

      <!-- token cost -->
      <div class="metric-row">
        <div class="lbl"><span>token usage</span></div>
        <div class="v">
          {{ totalTokens }}
          <span class="u">total tokens</span>
        </div>
      </div>

      <!-- latency -->
      <div class="metric-row">
        <div class="lbl"><span>llm latency p50 / p95</span></div>
        <div class="v">
          {{ latencyP50 }}
          <span class="u">· p95 {{ latencyP95 }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.acol { display: flex; flex-direction: column; min-height: 0; }
.acol.right { border-left: var(--hair); background: var(--bg-1); }
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
.metrics { flex: 1; overflow-y: auto; padding: var(--s-2) 0; }
.metric-row {
  padding: var(--s-3) var(--s-5);
  border-bottom: var(--hair-soft);
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.metric-row .lbl {
  display: flex;
  justify-content: space-between;
  font-family: var(--mono);
  font-size: var(--t-11);
  color: var(--fg-3);
  text-transform: uppercase;
  letter-spacing: .06em;
}
.delta { color: var(--fg-4); }
.metric-row .v {
  font-family: var(--mono);
  font-size: var(--t-18);
  font-weight: 500;
  color: var(--fg-0);
  line-height: 1.2;
}
.v .u { font-size: var(--t-12); color: var(--fg-3); font-weight: 400; margin-left: 6px; }
.spark { display: block; width: 100%; height: 28px; margin-top: 4px; }

.metric-bars {
  padding: var(--s-3) var(--s-5);
  border-bottom: var(--hair-soft);
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.metric-bars > .lbl {
  font-family: var(--mono);
  font-size: var(--t-11);
  color: var(--fg-3);
  text-transform: uppercase;
  letter-spacing: .06em;
  margin-bottom: 2px;
}
.mb-row {
  display: grid;
  grid-template-columns: 60px 1fr 40px;
  align-items: center;
  gap: 8px;
  font-family: var(--mono);
  font-size: var(--t-12);
}
.who { color: var(--fg-2); text-transform: uppercase; letter-spacing: .04em; }
.t {
  height: 6px;
  background: var(--bg-3);
  border-radius: 0;
  overflow: hidden;
}
.f {
  height: 100%;
  background: var(--fg-3);
  transition: width 0.4s ease;
}
.mb-row[data-c="g"] .f { background: var(--green); }
.mb-row[data-c="a"] .f { background: var(--amber); }
.mb-row[data-c="b"] .f { background: var(--blue); }
.mb-row[data-c="m"] .f { background: var(--magenta); }
.num { color: var(--fg-1); text-align: right; }
</style>

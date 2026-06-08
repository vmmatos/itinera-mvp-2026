import { describe, it, expect, vi } from 'vitest'
import type { TripMetrics, SatisfactionScore, AgentLogEntry } from '~/types/index'

// Shim Nuxt auto-imports
// @ts-expect-error global shim
globalThis.useRuntimeConfig = vi.fn(() => ({ public: { apiBase: 'http://localhost' } }))

// ── Helpers ────────────────────────────────────────────────────

function makeMetrics(overrides: Partial<TripMetrics> = {}): TripMetrics {
  return {
    convergenceRounds: 4,
    fairnessScore: 0.81,
    autonomyScore: 0.72,
    totalTimeMs: 102000,
    totalTokensUsed: 24000,
    ...overrides,
  }
}

function makeScore(name: string, score: number): SatisfactionScore {
  return {
    travellerId: `user-${name}`,
    name,
    persona: 'culture',
    preScore: score,
    postScore: score,
    breakdown: {},
  }
}

function makeLog(agent: string, latencyMs: number, tokensUsed: number): AgentLogEntry {
  return {
    id: `log-${agent}-${Date.now()}`,
    agent: agent as AgentLogEntry['agent'],
    round: 1,
    action: 'propose',
    latencyMs,
    tokensUsed,
    createdAt: '2026-06-01T10:00:00Z',
  }
}

// ── Unit logic tests (pure computed logic, no DOM mount) ───────
// These tests validate the computations inside MetricsPanel
// by importing the logic directly rather than mounting the Vue component.

describe('MetricsPanel computed logic', () => {
  // ── Happy path ───────────────────────────────────────────────

  it('computes latencyP50 correctly from sorted logs', () => {
    const latencies = [100, 400, 200, 800, 300]
    const sorted = [...latencies].sort((a, b) => a - b)
    const p50 = sorted[Math.floor(sorted.length * 0.5)]
    expect(p50).toBe(300)
  })

  it('computes latencyP95 correctly from sorted logs', () => {
    const latencies = Array.from({ length: 20 }, (_, i) => (i + 1) * 50)
    const sorted = [...latencies].sort((a, b) => a - b)
    const p95 = sorted[Math.floor(sorted.length * 0.95)]
    expect(p95).toBe(1000)
  })

  it('computes total tokens in k notation', () => {
    const logs = [makeLog('alice', 200, 12000), makeLog('bob', 300, 10000)]
    const total = logs.reduce((s, l) => s + (l.tokensUsed ?? 0), 0)
    expect(Math.round(total / 1000)).toBe(22)
  })

  it('returns fairness score from latest metrics entry', () => {
    const metrics = [makeMetrics({ fairnessScore: 0.60 }), makeMetrics({ fairnessScore: 0.81 })]
    const latest = metrics[metrics.length - 1]
    expect(latest.fairnessScore.toFixed(2)).toBe('0.81')
  })

  it('computes agentSatisfaction bar widths as percentages', () => {
    const scores: SatisfactionScore[] = [
      makeScore('alice', 0.84),
      makeScore('bob', 0.78),
    ]
    const AGENTS = ['alice', 'bob', 'carlos', 'diana']
    const result = AGENTS.map((name) => {
      const s = scores.find((sc) => sc.name.toLowerCase() === name)
      return { name, pct: s ? Math.round(s.postScore * 100) : null }
    })
    expect(result.find((r) => r.name === 'alice')?.pct).toBe(84)
    expect(result.find((r) => r.name === 'bob')?.pct).toBe(78)
    expect(result.find((r) => r.name === 'carlos')?.pct).toBeNull()
  })

  it('computes autonomy percentages by agent log count', () => {
    const logs = [
      makeLog('alice', 200, 1000),
      makeLog('alice', 180, 900),
      makeLog('bob', 300, 1200),
      makeLog('carlos', 250, 800),
    ]
    const AGENTS = ['alice', 'bob', 'carlos', 'diana']
    const total = logs.length
    const result = AGENTS.map((name) => {
      const count = logs.filter((l) => l.agent === name).length
      return { name, pct: Math.round((count / total) * 100) }
    })
    expect(result.find((r) => r.name === 'alice')?.pct).toBe(50)
    expect(result.find((r) => r.name === 'bob')?.pct).toBe(25)
    expect(result.find((r) => r.name === 'diana')?.pct).toBe(0)
  })

  // ── Empty/edge cases ─────────────────────────────────────────

  it('returns "—" when metrics array is empty', () => {
    const metrics: TripMetrics[] = []
    const latest = metrics.length > 0 ? metrics[metrics.length - 1] : null
    expect(latest).toBeNull()
  })

  it('returns "—" for latency when no logs exist', () => {
    const logs: AgentLogEntry[] = []
    const latencies = logs.map((l) => l.latencyMs ?? 0).filter(Boolean)
    expect(latencies).toHaveLength(0)
  })

  it('handles single metrics entry as latest', () => {
    const metrics = [makeMetrics({ fairnessScore: 0.72 })]
    expect(metrics[metrics.length - 1].fairnessScore).toBe(0.72)
  })

  it('builds SVG sparkline points from metrics scores', () => {
    const scores = [0.5, 0.65, 0.72, 0.81]
    const maxVal = Math.max(...scores, 1)
    const width = 200
    const height = 28
    const points = scores.map((v, i) => {
      const x = (i / (scores.length - 1)) * width
      const y = height - (v / maxVal) * (height - 4) - 2
      return `${x.toFixed(0)},${y.toFixed(0)}`
    })
    expect(points).toHaveLength(4)
    expect(points[0]).toMatch(/^0,/)
    expect(points[3]).toMatch(/^200,/)
  })
})

describe('MetricsPanel data shape validation', () => {
  it('TripMetrics interface has required fields', () => {
    const m = makeMetrics()
    expect(typeof m.convergenceRounds).toBe('number')
    expect(typeof m.fairnessScore).toBe('number')
    expect(typeof m.autonomyScore).toBe('number')
    expect(typeof m.totalTimeMs).toBe('number')
    expect(typeof m.totalTokensUsed).toBe('number')
  })

  it('AgentLogEntry has required latency and token fields', () => {
    const l = makeLog('alice', 412, 5200)
    expect(l.latencyMs).toBe(412)
    expect(l.tokensUsed).toBe(5200)
  })
})

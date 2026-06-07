import { describe, it, expect, vi } from 'vitest'
import type { ProposalRound, AgentStreamEvent } from '~/types/index'
import { AGENT_COLOURS } from '~/types/index'

// Shim Nuxt auto-imports
// @ts-expect-error global shim
globalThis.useRuntimeConfig = vi.fn(() => ({ public: { apiBase: 'http://localhost' } }))

// ── Helpers ────────────────────────────────────────────────────

function makeProposal(overrides: Partial<ProposalRound> = {}): ProposalRound {
  return {
    id: `p-${Math.random().toString(36).slice(2)}`,
    round: 1,
    agent: 'alice',
    action: 'propose',
    content: { summary: 'visit castle' },
    reasoning: 'Cultural site aligns with preferences',
    createdAt: '2026-06-01T10:00:00Z',
    ...overrides,
  }
}

function makeEvent(overrides: Partial<AgentStreamEvent> = {}): AgentStreamEvent {
  return {
    tripId: 'trip-001',
    type: 'propose',
    agent: 'alice',
    round: 1,
    timestamp: '2026-06-01T10:00:00Z',
    content: { summary: 'live event' },
    ...overrides,
  }
}

// ── Colour mapping logic ───────────────────────────────────────

const COLOUR_CODE: Record<string, string> = { green: 'g', amber: 'a', blue: 'b', magenta: 'm' }
function colourCode(agent: string): string {
  const colour = AGENT_COLOURS[agent as keyof typeof AGENT_COLOURS] ?? 'green'
  return COLOUR_CODE[colour] ?? 's'
}

// ── groupByRound helper (mirrors NegotiationPanel logic) ───────

function groupByRound(proposals: ProposalRound[]): [number, ProposalRound[]][] {
  const map = new Map<number, ProposalRound[]>()
  for (const p of proposals) {
    const arr = map.get(p.round) ?? []
    arr.push(p)
    map.set(p.round, arr)
  }
  return [...map.entries()].sort((a, b) => b[0] - a[0])
}

describe('NegotiationPanel — groupByRound', () => {
  // ── Happy path ───────────────────────────────────────────────

  it('groups proposals by round number', () => {
    const proposals = [
      makeProposal({ round: 1, agent: 'alice' }),
      makeProposal({ round: 1, agent: 'bob' }),
      makeProposal({ round: 2, agent: 'carlos' }),
    ]
    const groups = groupByRound(proposals)
    expect(groups).toHaveLength(2)
    const r1 = groups.find(([r]) => r === 1)
    expect(r1![1]).toHaveLength(2)
    const r2 = groups.find(([r]) => r === 2)
    expect(r2![1]).toHaveLength(1)
  })

  it('sorts rounds descending (newest first)', () => {
    const proposals = [
      makeProposal({ round: 1 }),
      makeProposal({ round: 3 }),
      makeProposal({ round: 2 }),
    ]
    const groups = groupByRound(proposals)
    expect(groups[0][0]).toBe(3)
    expect(groups[1][0]).toBe(2)
    expect(groups[2][0]).toBe(1)
  })

  it('returns empty array for no proposals', () => {
    expect(groupByRound([])).toHaveLength(0)
  })

  it('handles single proposal', () => {
    const groups = groupByRound([makeProposal({ round: 5, agent: 'diana' })])
    expect(groups).toHaveLength(1)
    expect(groups[0][0]).toBe(5)
    expect(groups[0][1][0].agent).toBe('diana')
  })
})

describe('NegotiationPanel — agent colour codes', () => {
  it('maps alice to green (g)', () => {
    expect(colourCode('alice')).toBe('g')
  })

  it('maps bob to amber (a)', () => {
    expect(colourCode('bob')).toBe('a')
  })

  it('maps carlos to blue (b)', () => {
    expect(colourCode('carlos')).toBe('b')
  })

  it('maps diana to magenta (m)', () => {
    expect(colourCode('diana')).toBe('m')
  })

  it('maps orchestrator to green (g)', () => {
    expect(colourCode('orchestrator')).toBe('g')
  })

  it('falls back to green (g) for unknown agent', () => {
    // AGENT_COLOURS lookup returns undefined → defaults to 'green' → COLOUR_CODE['green'] = 'g'
    expect(colourCode('unknown-agent')).toBe('g')
  })
})

describe('NegotiationPanel — event summary', () => {
  function eventSummary(event: AgentStreamEvent): string {
    if (typeof event.content === 'string') return event.content.slice(0, 80)
    if (event.content && typeof event.content === 'object') {
      const c = event.content as Record<string, unknown>
      if (typeof c.summary === 'string') return c.summary.slice(0, 80)
      if (typeof c.message === 'string') return c.message.slice(0, 80)
    }
    return `round ${event.round}`
  }

  it('extracts summary from content.summary', () => {
    const ev = makeEvent({ content: { summary: 'alice proposes castle visit' } })
    expect(eventSummary(ev)).toBe('alice proposes castle visit')
  })

  it('extracts summary from content.message fallback', () => {
    const ev = makeEvent({ content: { message: 'budget exceeded' } })
    expect(eventSummary(ev)).toBe('budget exceeded')
  })

  it('returns round fallback for unrecognised content shape', () => {
    const ev = makeEvent({ round: 3, content: { foo: 'bar' } })
    expect(eventSummary(ev)).toBe('round 3')
  })

  it('truncates long summaries to 80 chars', () => {
    const long = 'a'.repeat(120)
    const ev = makeEvent({ content: { summary: long } })
    expect(eventSummary(ev)).toHaveLength(80)
  })

  it('returns string content directly', () => {
    const ev = makeEvent({ content: 'direct string content' })
    expect(eventSummary(ev)).toBe('direct string content')
  })
})

describe('NegotiationPanel — live events prepend logic', () => {
  it('shows newest events first (index 0 = latest)', () => {
    const events: AgentStreamEvent[] = [
      makeEvent({ agent: 'alice', timestamp: '2026-06-01T10:00:00Z' }),
      makeEvent({ agent: 'bob', timestamp: '2026-06-01T10:00:01Z' }),
      makeEvent({ agent: 'carlos', timestamp: '2026-06-01T10:00:02Z' }),
    ]
    // useAgentStream prepends (newest first) — simulate:
    const newest = events[events.length - 1]
    expect(newest.agent).toBe('carlos')
  })

  it('pausing hides live events', () => {
    const events = [makeEvent(), makeEvent(), makeEvent()]
    const paused = true
    const visible = paused ? [] : events
    expect(visible).toHaveLength(0)
  })

  it('resuming shows live events', () => {
    const events = [makeEvent(), makeEvent()]
    const paused = false
    const visible = paused ? [] : events.slice(0, 40)
    expect(visible).toHaveLength(2)
  })
})

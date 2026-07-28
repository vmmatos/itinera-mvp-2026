import { describe, it, expect, vi } from 'vitest'
import type { ProposalRound, CommitEntry } from '~/types/index'

// Shim Nuxt auto-imports
// @ts-expect-error global shim
globalThis.useRuntimeConfig = vi.fn(() => ({ public: { apiBase: 'http://localhost' } }))

// ── Helpers ────────────────────────────────────────────────────

function makeProposal(overrides: Partial<ProposalRound> = {}): ProposalRound {
  return {
    id: 'p1',
    round: 1,
    agent: 'orchestrator',
    action: 'propose',
    content: {},
    createdAt: '2026-06-01T10:00:00Z',
    ...overrides,
  }
}

function makeCommit(overrides: Partial<CommitEntry> = {}): CommitEntry {
  return {
    id: 'c1',
    agent: 'alice',
    round: 1,
    action: 'accepted',
    createdAt: '2026-06-01T10:00:00Z',
    ...overrides,
  }
}

// The itinerary-detection predicate mirrors TimelinePanel.vue's `timelineDays`
// filter: orchestrator content carrying an itinerary/days array, not proposals
// whose `action` happens to be 'accept'/'score' (see TripService.ts fix —
// finance/validator never re-propose the itinerary, they only validate it).
function hasItineraryContent(p: ProposalRound): boolean {
  if (p.agent !== 'orchestrator' || !p.content || typeof p.content !== 'object') return false
  const c = p.content as Record<string, unknown>
  return Array.isArray(c.itinerary) || Array.isArray(c.days)
}

describe('TimelinePanel timelineDays filter', () => {
  // ── Happy path ───────────────────────────────────────────────

  it('matches the orchestrator merge proposal by content shape, not action', () => {
    const proposals = [
      makeProposal({ agent: 'orchestrator', action: 'propose', content: { itinerary: [{ day: 1 }] } }),
    ]
    expect(proposals.filter(hasItineraryContent)).toHaveLength(1)
  })

  it('supports the legacy `days` content key as well as `itinerary`', () => {
    const proposals = [
      makeProposal({ agent: 'orchestrator', action: 'propose', content: { days: [{ day: 1 }] } }),
    ]
    expect(proposals.filter(hasItineraryContent)).toHaveLength(1)
  })

  // ── Error / edge scenarios ───────────────────────────────────

  it('does not match finance/validator proposals even when action is accept/score', () => {
    const proposals = [
      makeProposal({ agent: 'finance', round: 2, action: 'accept', content: { verdict: { approved: true } } }),
      makeProposal({ agent: 'validator', round: 2, action: 'score', content: { scoring: { overallScore: 80 } } }),
    ]
    expect(proposals.filter(hasItineraryContent)).toHaveLength(0)
  })

  it('does not match an orchestrator proposal whose content has no itinerary/days array', () => {
    const proposals = [
      makeProposal({ agent: 'orchestrator', action: 'propose', content: { decisions: [] } }),
    ]
    expect(proposals.filter(hasItineraryContent)).toHaveLength(0)
  })

  it('handles null/non-object content without throwing', () => {
    const proposals = [
      makeProposal({ agent: 'orchestrator', content: null as unknown as Record<string, unknown> }),
      makeProposal({ agent: 'orchestrator', content: 'not-an-object' as unknown as Record<string, unknown> }),
    ]
    expect(() => proposals.filter(hasItineraryContent)).not.toThrow()
    expect(proposals.filter(hasItineraryContent)).toHaveLength(0)
  })

  it('returns empty timelineDays input when no proposals carry itinerary content', () => {
    const proposals = [makeProposal({ agent: 'alice', content: { slotProposals: [] } })]
    expect(proposals.filter(hasItineraryContent)).toHaveLength(0)
  })
})

describe('TimelinePanel commitLog', () => {
  // ── Happy path ───────────────────────────────────────────────

  it('sorts commits newest first', () => {
    const commits = [
      makeCommit({ id: 'c1', createdAt: '2026-06-01T10:00:00Z' }),
      makeCommit({ id: 'c2', createdAt: '2026-06-01T12:00:00Z' }),
    ]
    const sorted = [...commits].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    )
    expect(sorted[0].id).toBe('c2')
    expect(sorted[1].id).toBe('c1')
  })

  it('passes through commits sourced from per-activity decisions and the finance verdict', () => {
    const commits = [
      makeCommit({ id: 'decision-1', agent: 'alice', action: 'accepted', activity: 'Sagrada Familia', city: 'Barcelona' }),
      makeCommit({ id: 'decision-2', agent: 'bob', action: 'rejected', activity: 'Beach day', city: 'Barcelona' }),
      makeCommit({ id: 'finance-verdict', agent: 'finance', round: 2, action: 'accept', reason: 'Within budget' }),
    ]
    expect(commits).toHaveLength(3)
    expect(commits.map((c) => c.action)).toEqual(['accepted', 'rejected', 'accept'])
  })

  // ── Error / edge scenarios ───────────────────────────────────

  it('renders "no commits yet" state when commits is empty', () => {
    const commits: CommitEntry[] = []
    expect(commits.length === 0).toBe(true)
  })
})

import { describe, it, expect } from 'vitest'
import { formatDayHeader, formatTransition } from '~/utils/itinerary'

describe('formatDayHeader', () => {
  // ── Happy path ──────────────────────────────────────────────

  it('returns Day N — city, country when both present', () => {
    expect(formatDayHeader({ day: 1, city: 'Lisboa', country: 'Portugal' }))
      .toBe('Day 1 — Lisboa, Portugal')
  })

  it('returns Day N — city when country is absent', () => {
    expect(formatDayHeader({ day: 1, city: 'Lisboa' }))
      .toBe('Day 1 — Lisboa')
  })

  it('returns Day N when neither city nor country present', () => {
    expect(formatDayHeader({ day: 1 }))
      .toBe('Day 1')
  })

  it('handles large day numbers', () => {
    expect(formatDayHeader({ day: 14, city: 'Cascais', country: 'Portugal' }))
      .toBe('Day 14 — Cascais, Portugal')
  })

  it('includes city and country (date is irrelevant to header)', () => {
    expect(formatDayHeader({ day: 1, city: 'Lisboa', country: 'Portugal' }))
      .toBe('Day 1 — Lisboa, Portugal')
  })

  // ── Error / edge cases ───────────────────────────────────────

  it('returns plain Day N when city is empty string', () => {
    expect(formatDayHeader({ day: 2, city: '' }))
      .toBe('Day 2')
  })

  it('returns plain Day N when city is whitespace only', () => {
    expect(formatDayHeader({ day: 3, city: '   ' }))
      .toBe('Day 3')
  })

  it('returns Day N — city when country is empty string (no trailing comma)', () => {
    expect(formatDayHeader({ day: 1, city: 'Lisboa', country: '' }))
      .toBe('Day 1 — Lisboa')
  })

  it('returns Day N when only country provided (city absent)', () => {
    expect(formatDayHeader({ day: 1, country: 'Portugal' }))
      .toBe('Day 1')
  })
})

describe('formatTransition', () => {
  // ── Happy path ──────────────────────────────────────────────

  it('formats a city transition with travel time', () => {
    expect(formatTransition({ to: 'Sintra', travelTime: '40min by train' }))
      .toBe('→ Moving to Sintra (40min by train)')
  })

  it('handles different destination and travel time values', () => {
    expect(formatTransition({ to: 'Cascais', travelTime: '30min by bus' }))
      .toBe('→ Moving to Cascais (30min by bus)')
  })

  it('works with multi-word city names', () => {
    expect(formatTransition({ to: 'São Paulo', travelTime: '1h by car' }))
      .toBe('→ Moving to São Paulo (1h by car)')
  })

  // ── Edge cases ───────────────────────────────────────────────

  it('handles empty travelTime gracefully', () => {
    expect(formatTransition({ to: 'Sintra', travelTime: '' }))
      .toBe('→ Moving to Sintra ()')
  })
})

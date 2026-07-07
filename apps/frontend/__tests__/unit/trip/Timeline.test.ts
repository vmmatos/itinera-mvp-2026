import { describe, it, expect } from 'vitest'
import { formatDayHeader, formatTransition, warningsForDay } from '~/utils/itinerary'
import type { RestrictionWarning } from '~/utils/itinerary'

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

describe('warningsForDay', () => {
  // ── Happy path ──────────────────────────────────────────────

  const holiday: RestrictionWarning = {
    day: 1, activityName: 'Jerónimos Monastery', warningType: 'public_holiday',
    message: '⚠ Jerónimos Monastery is likely closed on June 10 (Portugal Day)',
  }
  const sundayClosure: RestrictionWarning = {
    day: 1, activityName: 'Lidl supermarket', warningType: 'sunday_closure',
    message: '⚠ Most shops are closed on Sundays in Germany.',
  }
  const mondayClosure: RestrictionWarning = {
    day: 2, activityName: 'Musée d\'Orsay', warningType: 'monday_closure',
    message: '⚠ Many museums are closed on Mondays in France.',
  }

  it('returns only the warnings matching the given day', () => {
    expect(warningsForDay([holiday, sundayClosure, mondayClosure], 1))
      .toEqual([holiday, sundayClosure])
  })

  it('returns multiple warnings for the same day, in order', () => {
    const result = warningsForDay([holiday, sundayClosure, mondayClosure], 1)
    expect(result).toHaveLength(2)
    expect(result[0]).toBe(holiday)
    expect(result[1]).toBe(sundayClosure)
  })

  // ── Error / edge cases ───────────────────────────────────────

  it('returns an empty array when no warning matches the day', () => {
    expect(warningsForDay([holiday], 3)).toEqual([])
  })

  it('returns an empty array when warnings is undefined', () => {
    expect(warningsForDay(undefined, 1)).toEqual([])
  })

  it('returns an empty array when warnings is an empty array', () => {
    expect(warningsForDay([], 1)).toEqual([])
  })
})

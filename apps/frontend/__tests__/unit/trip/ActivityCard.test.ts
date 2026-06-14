import { describe, it, expect } from 'vitest'
import { formatLocation } from '~/utils/itinerary'

describe('formatLocation', () => {
  // ── Happy path ──────────────────────────────────────────────

  it('returns venue · city when both present', () => {
    expect(formatLocation({ venue: 'Museu do Azulejo', city: 'Lisboa' }))
      .toBe('Museu do Azulejo · Lisboa')
  })

  it('returns venue only when city is absent', () => {
    expect(formatLocation({ venue: 'Museu do Azulejo' }))
      .toBe('Museu do Azulejo')
  })

  it('returns city, country when venue is absent', () => {
    expect(formatLocation({ city: 'Lisboa', country: 'Portugal' }))
      .toBe('Lisboa, Portugal')
  })

  it('returns city only when venue and country are absent', () => {
    expect(formatLocation({ city: 'Lisboa' }))
      .toBe('Lisboa')
  })

  it('returns legacy location string as final fallback', () => {
    expect(formatLocation({ location: 'Rua da Madre de Deus 4' }))
      .toBe('Rua da Madre de Deus 4')
  })

  it('prefers venue over legacy location', () => {
    expect(formatLocation({ venue: 'Museu do Azulejo', location: 'old location' }))
      .toBe('Museu do Azulejo')
  })

  it('prefers city + country over legacy location when venue absent', () => {
    expect(formatLocation({ city: 'Sintra', country: 'Portugal', location: 'old' }))
      .toBe('Sintra, Portugal')
  })

  // ── Error / edge cases ───────────────────────────────────────

  it('returns empty string when all fields are undefined', () => {
    expect(formatLocation({})).toBe('')
  })

  it('returns empty string when all fields are empty strings', () => {
    expect(formatLocation({ venue: '', city: '', country: '', location: '' }))
      .toBe('')
  })

  it('treats empty string venue as absent, falls back to city', () => {
    expect(formatLocation({ venue: '', city: 'Lisboa', country: 'Portugal' }))
      .toBe('Lisboa, Portugal')
  })

  it('treats whitespace-only venue as absent', () => {
    expect(formatLocation({ venue: '   ', city: 'Lisboa' }))
      .toBe('Lisboa')
  })

  it('treats empty string city as absent when combined with country', () => {
    expect(formatLocation({ city: '', country: 'Portugal', location: 'fallback' }))
      .toBe('fallback')
  })
})

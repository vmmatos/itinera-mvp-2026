import { describe, it, expect } from 'vitest'
import { modeName, optHeadLabel, priceDelta, transitQualifier, localModeIcon, buildGettingThereVM } from '~/utils/itinerary'
import type { TransportOption, LocalTransportPriorityResult } from '~/types/index'

function opt(overrides: Partial<TransportOption> = {}): TransportOption {
  return { mode: 'car', durationMinutes: 60, warnings: [], ...overrides }
}

describe('modeName', () => {
  it('maps the four known modes and falls back to Drive', () => {
    expect(modeName('flight')).toBe('Flight')
    expect(modeName('train')).toBe('Train')
    expect(modeName('bus')).toBe('Bus')
    expect(modeName('car')).toBe('Drive')
    expect(modeName('unknown')).toBe('Drive')
  })
})

describe('optHeadLabel', () => {
  it('prefers displaySummary when present (multi-leg routes)', () => {
    const o = opt({ mode: 'train', trainLine: 'Alfa-Pendular', displaySummary: 'Bus + Train — 4h total, ~€94/person' })
    expect(optHeadLabel(o, 'Porto')).toBe('Bus + Train — 4h total, ~€94/person')
  })

  it('falls back to flightNumber, then trainLine, then provider, in that order', () => {
    expect(optHeadLabel(opt({ mode: 'flight', flightNumber: 'TP1929', trainLine: 'X', provider: 'Y' }), 'Comporta'))
      .toBe('Flight TP1929 →Comporta')
    expect(optHeadLabel(opt({ mode: 'train', trainLine: 'Alfa-Pendular', provider: 'CP' }), 'Porto'))
      .toBe('Train Alfa-Pendular →Porto')
    expect(optHeadLabel(opt({ mode: 'train', provider: 'CP' }), 'Porto'))
      .toBe('Train CP →Porto')
  })

  it('drops the ref segment entirely when there is no name to show', () => {
    expect(optHeadLabel(opt({ mode: 'car' }), 'Porto')).toBe('Drive →Porto')
  })
})

describe('priceDelta', () => {
  it('returns a positive delta prefixed with +', () => {
    expect(priceDelta(opt({ priceEur: 23 }), opt({ priceEur: 13 }))).toBe('+€10')
  })

  it('returns a negative delta prefixed with the minus sign', () => {
    expect(priceDelta(opt({ priceEur: 8 }), opt({ priceEur: 13 }))).toBe('−€5')
  })

  it('returns an empty string when prices are equal', () => {
    expect(priceDelta(opt({ priceEur: 13 }), opt({ priceEur: 13 }))).toBe('')
  })

  it('error: returns an empty string when either side is missing a price', () => {
    expect(priceDelta(opt({}), opt({ priceEur: 13 }))).toBe('')
    expect(priceDelta(opt({ priceEur: 13 }), undefined)).toBe('')
  })
})

describe('transitQualifier', () => {
  it('calls out the cheapest option against the next cheapest alternative', () => {
    const selected = opt({ priceEur: 13, durationMinutes: 44 })
    const alts = [opt({ priceEur: 23, durationMinutes: 38 }), opt({ priceEur: 28, durationMinutes: 51 })]
    expect(transitQualifier(selected, alts)).toBe('Cheapest option — €13 vs €23 alternative')
  })

  it('calls out the fastest option when it is not the cheapest', () => {
    const selected = opt({ priceEur: 30, durationMinutes: 30 })
    const alts = [opt({ priceEur: 20, durationMinutes: 60 })]
    expect(transitQualifier(selected, alts)).toBe('Fastest option — 0h 30m vs 1h')
  })

  it('error: falls back to a generic recommendation with no comparable alternatives', () => {
    expect(transitQualifier(opt({ priceEur: 13, durationMinutes: 44 }), [])).toBe('Recommended option')
  })
})

describe('localModeIcon', () => {
  it('maps the three local modes and falls back to an arrow', () => {
    expect(localModeIcon('drive')).toBe('🚗')
    expect(localModeIcon('transit')).toBe('🚌')
    expect(localModeIcon('walk')).toBe('🚶')
    expect(localModeIcon('unknown')).toBe('→')
  })
})

describe('buildGettingThereVM', () => {
  function localResult(overrides: Partial<LocalTransportPriorityResult['selectedOption']> = {}): LocalTransportPriorityResult {
    return {
      selectedMode: 'drive',
      wasPreferenceHonored: true,
      selectedOption: { mode: 'drive', durationMinutes: 12, warnings: [], ...overrides },
    }
  }

  it('builds a drive VM from localTransport', () => {
    expect(buildGettingThereVM({ localTransport: localResult() })).toEqual({
      icon: '🚗', modeKey: 'drive', durationLabel: '0h 12m', priceEurPerPerson: undefined,
    })
  })

  it('builds a transit VM with price from localTransport', () => {
    const vm = buildGettingThereVM({
      localTransport: localResult({ mode: 'transit', durationMinutes: 25, priceEur: 2 }),
    })
    expect(vm).toEqual({ icon: '🚌', modeKey: 'transit', durationLabel: '0h 25m', priceEurPerPerson: 2 })
  })

  it('builds a walk VM from localTransport', () => {
    const vm = buildGettingThereVM({ localTransport: localResult({ mode: 'walk', durationMinutes: 8 }) })
    expect(vm).toEqual({ icon: '🚶', modeKey: 'walk', durationLabel: '0h 8m', priceEurPerPerson: undefined })
  })

  it('builds a day-trip VM from dayTripTransport, preferred over localTransport', () => {
    const dayTripTransport = opt({ mode: 'car', durationMinutes: 90, priceEur: 40 })
    const vm = buildGettingThereVM({ dayTripTransport, localTransport: localResult() })
    expect(vm).toEqual({ icon: '🚗', modeKey: 'car', durationLabel: '1h 30m', priceEurPerPerson: 40 })
  })

  it('error: returns null when the activity is itself a transit leg', () => {
    expect(buildGettingThereVM({
      transportData: { to: 'Porto', selectedOption: opt(), alternatives: [] },
      localTransport: localResult(),
    })).toBeNull()
  })

  it('error: returns null when neither field is present', () => {
    expect(buildGettingThereVM({})).toBeNull()
  })

  it('error: returns null on malformed local transport (missing durationMinutes)', () => {
    const malformed = {
      selectedMode: 'drive',
      wasPreferenceHonored: true,
      selectedOption: { mode: 'drive', warnings: [] },
    } as unknown as LocalTransportPriorityResult
    expect(buildGettingThereVM({ localTransport: malformed })).toBeNull()
  })
})

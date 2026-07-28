import { describe, it, expect } from 'vitest'
import {
  getTimeSlot,
  groupIntoSegments,
  buildDayViewModels,
  buildTransitVM,
  budgetCategoriesToRows,
  weatherConditionEmoji,
  deriveHeatRisk,
  formatMoney,
  formatEur,
  currencySymbolFor,
  formatDateRange,
  dayCostMax,
  parseWeatherAssessment,
} from '~/utils/itineraryViewModel'
import type { ItineraryDay, BudgetBreakdown, TransportOption } from '~/types/index'

function day(overrides: Partial<ItineraryDay> = {}): ItineraryDay {
  return { day: 1, date: 'Sat 12 Jul', city: 'Mértola', activities: [], ...overrides }
}

const TRANSPORT_OPTION: TransportOption = {
  mode: 'car',
  durationMinutes: 295,
  priceEur: 107,
  warnings: [],
}

const BUDGET_BREAKDOWN: BudgetBreakdown = {
  currency: 'EUR',
  currencyMismatch: false,
  groupSize: 2,
  categories: {
    accommodation: { amountPerPerson: 286, amountTotal: 572, isEstimate: false, source: 'serpapi_google_hotels' },
    restaurants: { amountPerPerson: 142, amountTotal: 284, isEstimate: false, source: 'google_places_price_level' },
    activities: { amountPerPerson: 223, amountTotal: 446, isEstimate: false, source: 'attraction_db' },
    transport: { amountPerPerson: 189, amountTotal: 378, isEstimate: false, source: 'transport_service' },
    buffer: { amountPerPerson: 84, amountTotal: 168, isEstimate: false, source: 'heuristic_estimate' },
  },
  perPersonTotal: 924,
  grandTotal: 1848,
  budgetTotal: 2100,
  status: 'within_budget',
  percentageUsed: 44,
  overruns: [],
  suggestedCuts: [],
}

describe('getTimeSlot', () => {
  it('maps known keywords to a phase', () => {
    expect(getTimeSlot('morning')).toBe('morning')
    expect(getTimeSlot('14:00 afternoon activity')).toBe('afternoon')
    expect(getTimeSlot('evening stroll')).toBe('evening')
  })

  it('falls back to morning for missing or unrecognised time', () => {
    expect(getTimeSlot(undefined)).toBe('morning')
    expect(getTimeSlot('whenever')).toBe('morning')
  })

  it('buckets bare hour strings by time of day', () => {
    expect(getTimeSlot('09:00')).toBe('morning')
    expect(getTimeSlot('14:00')).toBe('afternoon')
    expect(getTimeSlot('20:00')).toBe('evening')
  })
})

describe('groupIntoSegments', () => {
  it('returns a single segment for a single-city trip, no transit gap', () => {
    const days = [day({ day: 1 }), day({ day: 2 }), day({ day: 3 })]
    const segments = groupIntoSegments(days)
    expect(segments).toHaveLength(1)
    expect(segments[0]?.dayIndexes).toEqual([0, 1, 2])
    expect(segments[0]?.transitAfter).toBeUndefined()
  })

  it('splits into segments per city with a transit gap between them', () => {
    const days = [
      day({ day: 1, city: 'Mértola' }),
      day({ day: 2, city: 'Mértola', cityTransition: { to: 'Seia', travelTime: '4h 55m' } }),
      day({ day: 3, city: 'Seia' }),
    ]
    const segments = groupIntoSegments(days)
    expect(segments).toHaveLength(2)
    expect(segments[0]?.city).toBe('Mértola')
    expect(segments[0]?.transitAfter?.label).toBe('4h 55m')
    expect(segments[1]?.city).toBe('Seia')
  })

  it('returns no segments for an empty itinerary', () => {
    expect(groupIntoSegments([])).toEqual([])
  })

  it('prefers the resolved transport leg duration over the raw cityTransition string when both exist', () => {
    const days = [
      day({
        day: 1,
        city: 'Mértola',
        cityTransition: { to: 'Seia', travelTime: '5h' },
        activities: [{ name: 'In transit', transportData: { to: 'Seia', selectedOption: TRANSPORT_OPTION, alternatives: [] } }],
      }),
      day({ day: 2, city: 'Seia' }),
    ]
    const segments = groupIntoSegments(days)
    expect(segments[0]?.transitAfter?.label).toBe('4h 55m')
  })

  it('attaches the transit gap to the origin segment when the transit day is already labelled with the destination city (morning departure)', () => {
    const days = [
      day({ day: 1, city: 'Mértola' }),
      day({ day: 2, city: 'Seia', cityTransition: { to: 'Seia', travelTime: '3h' } }),
      day({ day: 3, city: 'Seia' }),
    ]
    const segments = groupIntoSegments(days)
    expect(segments).toHaveLength(2)
    expect(segments[0]?.city).toBe('Mértola')
    expect(segments[0]?.transitAfter?.label).toBe('3h')
    expect(segments[1]?.city).toBe('Seia')
    expect(segments[1]?.transitAfter).toBeUndefined()
  })

  it('does not throw and drops the marker when a cityTransition appears on the very first day (no prior segment)', () => {
    const days = [
      day({ day: 1, city: 'Seia', cityTransition: { to: 'Seia', travelTime: '3h' } }),
      day({ day: 2, city: 'Seia' }),
    ]
    const segments = groupIntoSegments(days)
    expect(segments).toHaveLength(1)
    expect(segments[0]?.transitAfter).toBeUndefined()
  })
})

describe('buildDayViewModels', () => {
  it('sums activity and transit cost per day', () => {
    const days = [
      day({
        activities: [
          { name: 'Museum', cost: 18 },
          { name: 'Dinner', cost: 26 },
        ],
      }),
    ]
    const [vm] = buildDayViewModels(days, null, [], null)
    expect(vm?.costPerPerson).toBe(44)
  })

  it('apportions accommodation nightly rate and buffer share into each day of a matching city segment', () => {
    const days = [day({ city: 'Mértola' }), day({ day: 2, city: 'Mértola' })]
    const accommodation = [{ city: 'Mértola', pricePerNightPerPerson: 90, nights: 2 }]
    const budgetBreakdown = { ...BUDGET_BREAKDOWN, categories: { ...BUDGET_BREAKDOWN.categories, buffer: { amountPerPerson: 20, amountTotal: 40, isEstimate: false, source: 'x' } } }
    const vms = buildDayViewModels(days, null, accommodation, budgetBreakdown)
    expect(vms[0]?.costPerPerson).toBe(90 + 10) // nightly rate + half the buffer
    expect(vms[1]?.costPerPerson).toBe(90 + 10)
  })

  it('does not apportion accommodation cost for an unmatched city', () => {
    const days = [day({ city: 'Lisbon' })]
    const accommodation = [{ city: 'Porto', pricePerNightPerPerson: 90, nights: 1 }]
    const [vm] = buildDayViewModels(days, null, accommodation, null)
    expect(vm?.costPerPerson).toBe(0)
  })

  it('returns an empty array for an empty itinerary, no division-by-zero', () => {
    expect(buildDayViewModels([], null, [], null)).toEqual([])
  })

  it('attaches real weather when a matching day assessment exists', () => {
    const days = [day({ day: 1 })]
    const assessment = parseWeatherAssessment({
      overallRisk: 'high',
      dayAssessments: [{ day: 1, date: '2026-07-12', weatherRisk: 'high', tempHigh: 38, tempLow: 21, condition: 'Clear', precipitationProbability: 0, affectedActivities: [] }],
      timingIssues: [],
      summary: 'Hot.',
    })
    const [vm] = buildDayViewModels(days, assessment, [], null)
    expect(vm?.weather?.tempHigh).toBe(38)
    expect(vm?.weather?.risk).toBe('heat')
  })

  it('leaves weather null (not a fabricated "low risk") when no forecast matched the day', () => {
    const days = [day({ day: 5 })]
    const assessment = parseWeatherAssessment({ overallRisk: 'low', dayAssessments: [], timingIssues: [], summary: '' })
    const [vm] = buildDayViewModels(days, assessment, [], null)
    expect(vm?.weather).toBeNull()
  })

  it('flags a day as a transit day via cityTransition or a transportData activity', () => {
    const [a] = buildDayViewModels([day({ cityTransition: { to: 'Seia', travelTime: '5h' } })], null, [], null)
    expect(a?.isTransitDay).toBe(true)
    const [b] = buildDayViewModels([day({ activities: [{ name: 'x', transportData: { to: 'Seia', selectedOption: TRANSPORT_OPTION, alternatives: [] } }] })], null, [], null)
    expect(b?.isTransitDay).toBe(true)
    const [c] = buildDayViewModels([day()], null, [], null)
    expect(c?.isTransitDay).toBe(false)
  })

  it('buckets activities into their time-of-day slot', () => {
    const [vm] = buildDayViewModels([day({ activities: [{ name: 'Breakfast', time: 'morning' }, { name: 'Dinner', time: 'evening' }] })], null, [], null)
    expect(vm?.slots.morning).toHaveLength(1)
    expect(vm?.slots.evening).toHaveLength(1)
    expect(vm?.slots.afternoon).toHaveLength(0)
  })
})

describe('dayCostMax', () => {
  it('returns the highest per-day cost', () => {
    const days = buildDayViewModels(
      [day({ day: 1, activities: [{ name: 'a', cost: 10 }] }), day({ day: 2, activities: [{ name: 'b', cost: 50 }] })],
      null, [], null,
    )
    expect(dayCostMax(days)).toBe(50)
  })

  it('returns 1 (not 0) for an all-zero-cost itinerary, avoiding a division by zero in bar-height math', () => {
    const days = buildDayViewModels([day()], null, [], null)
    expect(dayCostMax(days)).toBe(1)
  })
})

describe('weatherConditionEmoji', () => {
  it('maps known OWM conditions', () => {
    expect(weatherConditionEmoji('Clear')).toBe('☀️')
    expect(weatherConditionEmoji('Rain')).toBe('🌧️')
  })

  it('falls back to a generic icon for an unknown or missing condition, never throws', () => {
    expect(weatherConditionEmoji('Tornado')).toBe('🌡️')
    expect(weatherConditionEmoji(undefined)).toBe('🌡️')
  })
})

describe('deriveHeatRisk', () => {
  it('flags heat at >= 37°C', () => {
    expect(deriveHeatRisk(37)).toBe('heat')
    expect(deriveHeatRisk(38)).toBe('heat')
  })

  it('reports low below the threshold', () => {
    expect(deriveHeatRisk(30)).toBe('low')
  })

  it('reports unknown (not a fabricated "low") when no temperature is available', () => {
    expect(deriveHeatRisk(undefined)).toBe('unknown')
  })
})

describe('formatMoney / formatEur / currencySymbolFor', () => {
  it('formats per-person amounts as-is', () => {
    expect(formatMoney(142, 'pp', 2, '€')).toBe('€142')
  })

  it('multiplies by traveller count in total mode', () => {
    expect(formatMoney(142, 'total', 2, '€')).toBe('€284')
  })

  it('passes a non-EUR symbol through verbatim (currency-mismatch regression guard)', () => {
    expect(formatMoney(100, 'pp', 1, '$')).toBe('$100')
    expect(currencySymbolFor('USD')).toBe('$')
    expect(currencySymbolFor('EUR')).toBe('€')
    expect(currencySymbolFor(undefined)).toBe('€')
  })

  it('formatEur always uses €, independent of the currencySymbol passed elsewhere — transport pricing is genuinely EUR-only', () => {
    expect(formatEur(107, 'pp', 2)).toBe('€107')
    expect(formatEur(107, 'total', 2)).toBe('€214')
  })
})

describe('formatDateRange', () => {
  it('collapses same-month ranges', () => {
    expect(formatDateRange('2026-07-12', '2026-07-19')).toBe('12–19 Jul 2026')
  })

  it('spells out both months for cross-month ranges', () => {
    expect(formatDateRange('2026-07-29', '2026-08-03')).toBe('29 Jul – 3 Aug 2026')
  })

  it('falls back gracefully for missing or unparseable dates', () => {
    expect(formatDateRange(undefined, '2026-07-19')).toBe('')
    expect(formatDateRange('not-a-date', '2026-07-19')).toBe('not-a-date – 2026-07-19')
  })
})

describe('budgetCategoriesToRows', () => {
  it('maps all 5 categories with fixed labels/colors', () => {
    const rows = budgetCategoriesToRows(BUDGET_BREAKDOWN)
    expect(rows).toHaveLength(5)
    expect(rows.map((r) => r.label)).toEqual(['Accommodation', 'Food & dining', 'Activities', 'Transport', 'Buffer (10%)'])
  })

  it('returns an empty array for a null breakdown, no throw', () => {
    expect(budgetCategoriesToRows(null)).toEqual([])
  })
})

describe('buildTransitVM', () => {
  it('maps the selected option and up to 3 alternatives', () => {
    const alts: TransportOption[] = [
      { mode: 'flight', durationMinutes: 220, priceEur: 189, warnings: [] },
      { mode: 'train', durationMinutes: 380, priceEur: 96, warnings: [] },
      { mode: 'bus', durationMinutes: 270, priceEur: 240, warnings: [] },
      { mode: 'car', durationMinutes: 300, priceEur: 300, warnings: [] },
    ]
    const vm = buildTransitVM({ name: 'In transit', transportData: { to: 'Seia', selectedOption: TRANSPORT_OPTION, alternatives: alts } })
    expect(vm?.destination).toBe('Seia')
    expect(vm?.priceEurPerPerson).toBe(107)
    expect(vm?.alternatives).toHaveLength(3)
  })

  it('surfaces a real warning verbatim when present', () => {
    const opt: TransportOption = { ...TRANSPORT_OPTION, warnings: ['Overnight layover required'] }
    const vm = buildTransitVM({ name: 'x', transportData: { to: 'Seia', selectedOption: opt, alternatives: [] } })
    expect(vm?.warning).toBe('Overnight layover required')
  })

  it('falls back to a generic long-journey warning only past 4h with no real warning', () => {
    const vm = buildTransitVM({ name: 'x', transportData: { to: 'Seia', selectedOption: TRANSPORT_OPTION, alternatives: [] } })
    expect(vm?.warning).toMatch(/long journey/i)
  })

  it('returns null for an activity with no transportData', () => {
    expect(buildTransitVM({ name: 'Museum visit' })).toBeNull()
  })
})

describe('parseWeatherAssessment', () => {
  it('returns null for a null input', () => {
    expect(parseWeatherAssessment(null)).toBeNull()
  })

  it('returns null when dayAssessments is missing or not an array (defensive, never throws)', () => {
    expect(parseWeatherAssessment({ overallRisk: 'low' })).toBeNull()
    expect(parseWeatherAssessment({ overallRisk: 'low', dayAssessments: 'nope' })).toBeNull()
  })

  it('parses a well-formed assessment', () => {
    const result = parseWeatherAssessment({
      overallRisk: 'heat' as unknown as string,
      dayAssessments: [{ day: 1, date: '2026-07-12', weatherRisk: 'high', tempHigh: 38, affectedActivities: [] }],
      timingIssues: [{ day: 4, activity1: 'A', activity2: 'B', issue: 'overlap', suggestion: 'reorder' }],
      summary: 'Hot week.',
    })
    expect(result?.dayAssessments).toHaveLength(1)
    expect(result?.timingIssues).toHaveLength(1)
    expect(result?.summary).toBe('Hot week.')
  })
})

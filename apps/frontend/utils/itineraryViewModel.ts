import type {
  ItineraryDay,
  ItineraryActivity,
  WeatherAssessment,
  WeatherDayAssessment,
  WeatherTimingIssue,
  BudgetBreakdown,
  BudgetCategory,
  TransportOption,
} from '~/types/index'
import { routeIcon, formatDuration } from '~/utils/itinerary'

// ── Time slot bucketing ──────────────────────────────────────────
// Pure copy of the logic in TripInputForm.vue (v1 stays untouched — that
// file's version is a local, unexported function).
export type Phase = 'morning' | 'afternoon' | 'evening'

export function getTimeSlot(time?: string): Phase {
  if (!time) return 'morning'
  const t = time.toLowerCase()
  if (t.includes('morn')) return 'morning'
  if (t.includes('after') || t.includes('noon')) return 'afternoon'
  if (t.includes('even') || t.includes('night')) return 'evening'
  const hourMatch = t.match(/^(\d{1,2})[:h]/)
  if (hourMatch?.[1]) {
    const h = parseInt(hourMatch[1], 10)
    if (h >= 6 && h < 12) return 'morning'
    if (h >= 12 && h < 18) return 'afternoon'
    if (h >= 18 || h < 6) return 'evening'
  }
  return 'morning'
}

// ── Formatting ────────────────────────────────────────────────────
function monthAbbrev(date: Date, locale: string): string {
  return new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' }).format(date)
}

export function formatDateRange(startDate?: string, endDate?: string): string {
  if (!startDate || !endDate) return ''
  const start = new Date(startDate)
  const end = new Date(endDate)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return `${startDate} – ${endDate}`

  const locale = useNuxtApp().$i18n.locale.value
  const endLabel = `${end.getUTCDate()} ${monthAbbrev(end, locale)} ${end.getUTCFullYear()}`
  const sameMonth = start.getUTCMonth() === end.getUTCMonth() && start.getUTCFullYear() === end.getUTCFullYear()
  if (sameMonth) return `${start.getUTCDate()}–${endLabel}`
  return `${start.getUTCDate()} ${monthAbbrev(start, locale)} – ${endLabel}`
}

// ── Currency ──────────────────────────────────────────────────────
const CURRENCY_SYMBOLS: Record<string, string> = { EUR: '€', USD: '$' }

export function currencySymbolFor(currencyCode?: string): string {
  if (!currencyCode) return '€'
  return CURRENCY_SYMBOLS[currencyCode] ?? `${currencyCode} `
}

// `symbol` must be sourced from budgetBreakdown.currency — never hardcode a
// symbol here, the trip's budget can be a non-EUR currency.
export function formatMoney(amountPerPerson: number, mode: 'pp' | 'total', travellers: number, symbol: string): string {
  const amount = mode === 'pp' ? amountPerPerson : amountPerPerson * travellers
  return `${symbol}${Math.round(amount).toLocaleString()}`
}

// Transport (`priceEur`) is always genuinely EUR — sourced directly from
// SerpApi/Amadeus regardless of the trip's budget currency (see
// TODO M79-currency). Hardcoding '€' here is correct, unlike the rest of the
// UI, which must always defer to budgetBreakdown.currency.
export function formatEur(amountPerPerson: number, mode: 'pp' | 'total', travellers: number): string {
  return formatMoney(amountPerPerson, mode, travellers, '€')
}

// ── Segments (rail) ───────────────────────────────────────────────
export interface TransitGapVM {
  icon: string
  label: string
}

export interface SegmentVM {
  city: string
  dayIndexes: number[]
  transitAfter?: TransitGapVM
}

function transitLabelForDay(day: ItineraryDay): TransitGapVM | undefined {
  const transitActivity = day.activities.find((a) => a.transportData)
  if (transitActivity?.transportData) {
    const opt = transitActivity.transportData.selectedOption
    return { icon: routeIcon(opt), label: formatDuration(opt.durationMinutes) }
  }
  if (day.cityTransition?.travelTime) {
    return { icon: '⇢', label: day.cityTransition.travelTime }
  }
  return undefined
}

export function groupIntoSegments(days: ItineraryDay[]): SegmentVM[] {
  const segments: SegmentVM[] = []
  days.forEach((day, i) => {
    const city = day.city?.trim() || 'Trip'
    const last = segments[segments.length - 1]
    const continuesSegment = !!last && last.city === city
    if (continuesSegment) {
      last!.dayIndexes.push(i)
    } else {
      segments.push({ city, dayIndexes: [i] })
    }
    if (day.cityTransition?.to) {
      const gap = transitLabelForDay(day)
      // The transit day may already be labelled with the destination city
      // (morning departure) instead of the origin (late departure) — the
      // marker always belongs to the origin segment, so pick it by comparing
      // this day's own city to the announced destination, not by segment index.
      const isDestinationLabelled = city === day.cityTransition.to
      const owner = isDestinationLabelled ? segments[segments.length - 2] : segments[segments.length - 1]
      if (gap && owner) owner.transitAfter = gap
    }
  })
  return segments
}

// ── Weather ───────────────────────────────────────────────────────
const CONDITION_EMOJI: Record<string, string> = {
  Clear: '☀️',
  Clouds: '⛅',
  Rain: '🌧️',
  Drizzle: '🌦️',
  Thunderstorm: '⛈️',
  Snow: '❄️',
  Mist: '🌫️',
  Fog: '🌫️',
  Haze: '🌫️',
}

// Maps the real OWM `condition` string — distinct from (and not to be
// conflated with) v1's risk-based weatherEmoji(risk) in TripInputForm.vue.
export function weatherConditionEmoji(condition?: string): string {
  if (!condition) return '🌡️'
  return CONDITION_EMOJI[condition] ?? '🌡️'
}

export type HeatRisk = 'heat' | 'low' | 'unknown'

// `undefined` tempHigh means no live forecast matched this day (flexible
// dates with no resolved month, or OpenWeatherMap had no data) — report
// 'unknown', never fabricate a risk level.
export function deriveHeatRisk(tempHigh?: number): HeatRisk {
  if (tempHigh === undefined) return 'unknown'
  return tempHigh >= 37 ? 'heat' : 'low'
}

export interface DayWeatherVM {
  icon: string
  condition?: string
  tempHigh?: number
  tempLow?: number
  precipitationProbability?: number
  risk: HeatRisk
}

// Narrows the loose Record<string,unknown> shape v1 still uses (the raw
// proposal JSON) into WeatherAssessment at the boundary. Defensive: any
// missing/malformed field falls back to a safe default rather than throwing
// — a malformed weather block must never crash the itinerary screen.
export function parseWeatherAssessment(raw: Record<string, unknown> | null): WeatherAssessment | null {
  if (!raw) return null
  const dayAssessmentsRaw = raw['dayAssessments']
  if (!Array.isArray(dayAssessmentsRaw)) return null

  const dayAssessments: WeatherDayAssessment[] = dayAssessmentsRaw
    .filter((d): d is Record<string, unknown> => !!d && typeof d === 'object')
    .map((d) => ({
      day: typeof d['day'] === 'number' ? d['day'] : 0,
      date: typeof d['date'] === 'string' ? d['date'] : null,
      weatherRisk: d['weatherRisk'] === 'medium' || d['weatherRisk'] === 'high' ? d['weatherRisk'] : 'low',
      tempHigh: typeof d['tempHigh'] === 'number' ? d['tempHigh'] : undefined,
      tempLow: typeof d['tempLow'] === 'number' ? d['tempLow'] : undefined,
      condition: typeof d['condition'] === 'string' ? d['condition'] : undefined,
      precipitationProbability: typeof d['precipitationProbability'] === 'number' ? d['precipitationProbability'] : undefined,
    }))

  const timingIssuesRaw = raw['timingIssues']
  const timingIssues: WeatherTimingIssue[] = Array.isArray(timingIssuesRaw)
    ? timingIssuesRaw
        .filter((t): t is Record<string, unknown> => !!t && typeof t === 'object')
        .map((t) => ({
          day: typeof t['day'] === 'number' ? t['day'] : 0,
          activity1: typeof t['activity1'] === 'string' ? t['activity1'] : '',
          activity2: typeof t['activity2'] === 'string' ? t['activity2'] : '',
          issue: typeof t['issue'] === 'string' ? t['issue'] : '',
          suggestion: typeof t['suggestion'] === 'string' ? t['suggestion'] : '',
        }))
    : []

  const overallRisk = raw['overallRisk']
  return {
    overallRisk: overallRisk === 'medium' || overallRisk === 'high' ? overallRisk : 'low',
    dayAssessments,
    timingIssues,
    summary: typeof raw['summary'] === 'string' ? raw['summary'] : '',
  }
}

function findDayAssessment(assessment: WeatherAssessment | null, dayNumber: number): WeatherDayAssessment | undefined {
  return assessment?.dayAssessments.find((d) => d.day === dayNumber)
}

function buildDayWeather(assessment: WeatherAssessment | null, dayNumber: number): DayWeatherVM | null {
  const match = findDayAssessment(assessment, dayNumber)
  if (!match) return null
  return {
    icon: weatherConditionEmoji(match.condition),
    condition: match.condition,
    tempHigh: match.tempHigh,
    tempLow: match.tempLow,
    precipitationProbability: match.precipitationProbability,
    risk: deriveHeatRisk(match.tempHigh),
  }
}

// ── Transit ───────────────────────────────────────────────────────
export interface TransitAltVM {
  icon: string
  label: string
  durationLabel: string
  priceEurPerPerson?: number
}

export interface TransitVM {
  icon: string
  modeLabel: string
  destination: string
  durationLabel: string
  priceEurPerPerson?: number
  subLabel?: string
  warning?: string
  alternatives: TransitAltVM[]
}

function altVM(opt: TransportOption): TransitAltVM {
  return {
    icon: routeIcon(opt),
    label: opt.mode === 'flight' ? 'Fly' : opt.mode === 'train' ? 'Train' : opt.mode === 'bus' ? 'Bus' : 'Drive',
    durationLabel: formatDuration(opt.durationMinutes),
    priceEurPerPerson: opt.priceEur,
  }
}

export function buildTransitVM(activity: ItineraryActivity): TransitVM | null {
  const td = activity.transportData
  if (!td) return null
  const opt = td.selectedOption
  const modeLabel = opt.mode === 'flight' ? 'Flight' : opt.mode === 'train' ? 'Train' : opt.mode === 'bus' ? 'Bus' : 'Drive'

  // Real warning from the resolved leg takes priority — the mock's flavor
  // sentence ("orchestrator trimmed travel-day activities") is decorative
  // copy in the HTML prototype, not data this app actually derives.
  const warning = opt.warnings[0]
    ?? (opt.durationMinutes > 240 ? 'Long journey — consider a lighter travel-day schedule' : undefined)

  return {
    icon: routeIcon(opt),
    modeLabel,
    destination: td.to,
    durationLabel: formatDuration(opt.durationMinutes),
    priceEurPerPerson: opt.priceEur,
    subLabel: opt.displaySummary,
    warning,
    alternatives: td.alternatives.slice(0, 3).map(altVM),
  }
}

// ── Day view models ───────────────────────────────────────────────
export interface SlotItemVM {
  title: string
  description?: string
  costPerPerson?: number
  agentName?: string
  location?: string
  country?: string
  transit: TransitVM | null
}

export interface DayVM {
  day: number
  index: number
  dateLabel: string
  city: string
  costPerPerson: number
  isTransitDay: boolean
  weather: DayWeatherVM | null
  slots: Record<Phase, SlotItemVM[]>
}

export interface AccommodationBlock {
  city: string
  pricePerNightPerPerson: number
  nights: number
}

function accommodationShareFor(day: ItineraryDay, accommodation: AccommodationBlock[]): number {
  const city = day.city?.trim().toLowerCase()
  if (!city) return 0
  const block = accommodation.find((a) => a.city.trim().toLowerCase() === city)
  return block?.pricePerNightPerPerson ?? 0
}

// Per-day cost is a derived estimate: real activity/transit costs plus an
// apportioned share of accommodation (one night's rate per day in that
// city's segment) and the budget's buffer (spread evenly across all days).
// Neither the backend nor timelineDays exposes a true per-day lodging split
// — this keeps the rail/chart numbers honest and roughly reconciled with the
// price hero rather than silently undercounting by omitting lodging.
export function buildDayViewModels(
  days: ItineraryDay[],
  weatherAssessment: WeatherAssessment | null,
  accommodation: AccommodationBlock[],
  budgetBreakdown: BudgetBreakdown | null,
): DayVM[] {
  const bufferPerDay = days.length > 0
    ? (budgetBreakdown?.categories.buffer.amountPerPerson ?? 0) / days.length
    : 0

  return days.map((day, index) => {
    const slots: Record<Phase, SlotItemVM[]> = { morning: [], afternoon: [], evening: [] }
    let activitiesCost = 0
    let transitCost = 0

    for (const activity of day.activities) {
      const transit = buildTransitVM(activity)
      if (transit?.priceEurPerPerson) transitCost += transit.priceEurPerPerson
      if (activity.cost) activitiesCost += activity.cost

      slots[getTimeSlot(activity.time)].push({
        title: activity.name,
        description: activity.notes,
        costPerPerson: activity.cost,
        agentName: activity.ownerAgent,
        location: activity.location,
        country: activity.country,
        transit,
      })
    }

    const accommodationShare = accommodationShareFor(day, accommodation)
    const costPerPerson = activitiesCost + transitCost + accommodationShare + bufferPerDay

    return {
      day: day.day,
      index,
      dateLabel: day.date ?? `Day ${day.day}`,
      city: day.city?.trim() || 'Trip',
      costPerPerson,
      isTransitDay: !!day.cityTransition || day.activities.some((a) => a.transportData),
      weather: buildDayWeather(weatherAssessment, day.day),
      slots,
    }
  })
}

export function dayCostMax(days: DayVM[]): number {
  return Math.max(1, ...days.map((d) => d.costPerPerson))
}

// ── Budget category rows ─────────────────────────────────────────
export interface CategoryRowVM {
  key: BudgetCategory
  label: string
  color: string
  amountPerPerson: number
  amountTotal: number
  isEstimate: boolean
}

const CATEGORY_META: Record<BudgetCategory, { label: string; color: string }> = {
  accommodation: { label: 'Accommodation', color: 'var(--green)' },
  restaurants:   { label: 'Food & dining', color: 'var(--amber)' },
  activities:    { label: 'Activities', color: 'var(--blue)' },
  transport:     { label: 'Transport', color: 'var(--magenta)' },
  buffer:        { label: 'Buffer (10%)', color: 'var(--fg-3)' },
}

const CATEGORY_ORDER: BudgetCategory[] = ['accommodation', 'restaurants', 'activities', 'transport', 'buffer']

export function budgetCategoriesToRows(bd: BudgetBreakdown | null): CategoryRowVM[] {
  if (!bd) return []
  return CATEGORY_ORDER.map((key) => {
    const detail = bd.categories[key]
    const meta = CATEGORY_META[key]
    return {
      key,
      label: meta.label,
      color: meta.color,
      amountPerPerson: detail.amountPerPerson,
      amountTotal: detail.amountTotal,
      isEstimate: detail.isEstimate,
    }
  })
}

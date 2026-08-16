import type { TransportOption, LocalTransportPriorityResult } from '~/types'

export interface LocationFields {
  venue?:    string
  city?:     string
  country?:  string
  location?: string
}

export interface DayHeaderFields {
  day:      number
  city?:    string
  country?: string
}

export interface RestrictionWarning {
  day:          number
  activityName: string
  warningType:  string
  message:      string
}

// Typed mirror of the shared backend SpecialEvent (services/shared/src/types/workflow.ts).
// Real-world event (festival, concert, sports fixture, etc — any Ticketmaster
// Discovery API segment) happening in a destination city during the trip.
// Informational only.
export interface SpecialEvent {
  id:               string
  name:             string
  url:              string
  startDate:        string
  startTime?:       string
  city:             string
  venueName?:       string
  category:         string
  genre?:           string
  imageUrl?:        string
  day?:             number
  matchesMustHave?: boolean
}

export interface CityTransitionFields {
  to:               string
  travelTime:       string
  transportOption?: {
    mode?:           string
    durationMinutes: number
    priceEur?:       number
    departureTime?:  string
    arrivalTime?:    string
    warnings:        string[]
  }
}

export function modeIcon(mode?: string): string {
  const icons: Record<string, string> = { flight: '✈️', train: '🚆', car: '🚗', bus: '🚌' }
  return icons[mode ?? ''] ?? '→'
}

// For multi-leg routes, use the icon of the main (last) segment so the chip reflects
// the dominant leg: Bus+Flight → ✈️, Bus+Car → 🚗, Bus+Train → 🚆.
export function routeIcon(opt: TransportOption): string {
  if (opt.segments && opt.segments.length > 1) {
    return modeIcon(opt.segments[opt.segments.length - 1]!.mode)
  }
  return modeIcon(opt.mode)
}

export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

export function modeName(mode: string): string {
  return mode === 'flight' ? 'Flight' : mode === 'train' ? 'Train' : mode === 'bus' ? 'Bus' : 'Drive'
}

// Route text for a transit row header. Multi-leg routes carry a pre-built
// displaySummary (e.g. "Bus + Train + Flight — 9h, ~€172/person"); direct
// routes get "Train TGV →Barcelona" style with the provider/ref.
export function optHeadLabel(opt: TransportOption, to: string): string {
  if (opt.displaySummary) return opt.displaySummary
  const ref = opt.flightNumber ?? opt.trainLine ?? opt.provider ?? ''
  return `${modeName(opt.mode)}${ref ? ` ${ref}` : ''} →${to}`
}

export function priceDelta(alt: TransportOption, base?: TransportOption): string {
  if (typeof alt.priceEur !== 'number' || typeof base?.priceEur !== 'number') return ''
  const d = alt.priceEur - base.priceEur
  if (d === 0) return ''
  return d > 0 ? `+€${d}` : `−€${Math.abs(d)}`
}

// One-line qualifier under the selected transit option: why it was picked.
// `comparableAlts` should already be stripped of bogus 0-duration entries.
export function transitQualifier(selected: TransportOption, comparableAlts: TransportOption[]): string {
  const all = [selected, ...comparableAlts]
  const priced = all.filter((o) => typeof o.priceEur === 'number') as Array<TransportOption & { priceEur: number }>

  if (priced.length > 1 && typeof selected.priceEur === 'number') {
    const cheapest = Math.min(...priced.map((o) => o.priceEur))
    if (selected.priceEur === cheapest) {
      const nextUp = priced.map((o) => o.priceEur).filter((p) => p > cheapest).sort((a, b) => a - b)[0]
      if (nextUp !== undefined) return `Cheapest option — €${selected.priceEur} vs €${nextUp} alternative`
    }
  }

  if (comparableAlts.length > 0) {
    const fastest = Math.min(...all.map((o) => o.durationMinutes))
    if (selected.durationMinutes === fastest) {
      const nextSlower = all.map((o) => o.durationMinutes).filter((m) => m > fastest).sort((a, b) => a - b)[0]
      if (nextSlower !== undefined) return `Fastest option — ${formatDuration(selected.durationMinutes)} vs ${formatDuration(nextSlower)}`
    }
  }

  return 'Recommended option'
}

export function formatLocation(act: LocationFields): string {
  const venue   = act.venue?.trim()
  const city    = act.city?.trim()
  const country = act.country?.trim()
  const loc     = act.location?.trim()
  if (venue && city)    return `${venue} · ${city}`
  if (venue)            return venue
  if (city && country)  return `${city}, ${country}`
  if (city)             return city
  return loc ?? ''
}

export function formatDayHeader(day: DayHeaderFields): string {
  const city    = day.city?.trim()
  const country = day.country?.trim()
  if (city && country) return `Day ${day.day} — ${city}, ${country}`
  if (city)            return `Day ${day.day} — ${city}`
  return `Day ${day.day}`
}

export function formatTransition(t: CityTransitionFields): string {
  return `→ Moving to ${t.to} (${t.travelTime})`
}

export function warningsForDay(warnings: RestrictionWarning[] | undefined, dayNum: number): RestrictionWarning[] {
  return (warnings ?? []).filter((w) => w.day === dayNum)
}

export function eventsForDay(events: SpecialEvent[] | undefined, dayNum: number): SpecialEvent[] {
  return (events ?? []).filter((e) => e.day === dayNum)
}

export function formatEventDateTime(e: SpecialEvent): string {
  const date = new Date(`${e.startDate}T00:00:00`)
  if (Number.isNaN(date.getTime())) return e.startDate

  const dateLabel = date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  if (!e.startTime) return dateLabel

  const time = e.startTime.slice(0, 5)
  return `${dateLabel} · ${time}`
}

export function localModeIcon(mode: string): string {
  const icons: Record<string, string> = {
    drive: '🚗', transit: '🚌', walk: '🚶',
    metro: '🚇', tram: '🚊', ferry: '⛴️',
    train: '🚆', bus: '🚌',
  }
  return icons[mode] ?? '→'
}

export type GettingThereModeKey = 'drive' | 'transit' | 'walk' | 'metro' | 'tram' | 'ferry' | TransportOption['mode']

// Google Routes' transitLine.vehicle.type is far finer-grained than our
// LocalTransportMode routing enum ('drive'|'transit'|'walk') — this only
// refines what icon/label the getting-there line shows, it does not touch
// routing/preference logic elsewhere (LocalTransportMode stays untouched).
// Deliberate simplification: CABLE_CAR/GONDOLA_LIFT/FUNICULAR are grouped
// under the 'tram' bucket rather than given individual treatment.
const TRANSIT_VEHICLE_MODE_KEY: Record<string, GettingThereModeKey> = {
  SUBWAY: 'metro', METRO_RAIL: 'metro', HEAVY_RAIL: 'metro',
  RAIL: 'train', COMMUTER_TRAIN: 'train', HIGH_SPEED_TRAIN: 'train',
  LONG_DISTANCE_TRAIN: 'train', MONORAIL: 'train',
  BUS: 'bus', INTERCITY_BUS: 'bus', TROLLEYBUS: 'bus', SHARE_TAXI: 'bus',
  TRAM: 'tram', CABLE_CAR: 'tram', GONDOLA_LIFT: 'tram', FUNICULAR: 'tram',
  FERRY: 'ferry',
}

// Falls back to the generic 'transit' bucket ("Public transport" / 🚌) when
// Google didn't return a vehicle type, or returned OTHER/UNKNOWN, or an
// enum value we don't recognize — never renders an undefined/broken label.
export function transitVehicleModeKey(vehicleType?: string): GettingThereModeKey {
  if (!vehicleType) return 'transit'
  return TRANSIT_VEHICLE_MODE_KEY[vehicleType] ?? 'transit'
}

export interface GettingThereVM {
  icon: string
  modeKey: GettingThereModeKey
  durationLabel: string
  priceEurPerPerson?: number
}

// All getting-there mode keys (local hops + day-trip transport) resolve to
// `trip.itinerary.daySlot.transportMode.*` i18n keys — pass the component's
// `t` in so ActivityCard.vue and DaySlot.vue render the same translated label.
export function gettingThereLabel(t: (key: string) => string, modeKey: GettingThereModeKey): string {
  return t(`trip.itinerary.daySlot.transportMode.${modeKey}`)
}

interface GettingThereSource {
  transportData?: unknown
  localTransport?: LocalTransportPriorityResult
  dayTripTransport?: TransportOption
}

// Bottom-of-card "how to get here" line: day-trip round-trip transport for
// far venues, or a local drive/transit/walk hop for everything else. Skips
// activities that ARE a transit leg themselves (transportData set) — those
// already render their own route card, a second line would be redundant.
export function buildGettingThereVM(activity: GettingThereSource): GettingThereVM | null {
  if (activity.transportData) return null

  const dtt = activity.dayTripTransport
  if (dtt && typeof dtt.durationMinutes === 'number') {
    return {
      icon: routeIcon(dtt),
      modeKey: dtt.mode,
      durationLabel: formatDuration(dtt.durationMinutes),
      priceEurPerPerson: dtt.priceEur,
    }
  }

  const opt = activity.localTransport?.selectedOption
  if (opt && typeof opt.durationMinutes === 'number') {
    const modeKey = opt.mode === 'transit' ? transitVehicleModeKey(opt.transitVehicleType) : opt.mode
    return {
      icon: localModeIcon(modeKey),
      modeKey,
      durationLabel: formatDuration(opt.durationMinutes),
      priceEurPerPerson: opt.priceEur,
    }
  }

  return null
}

export function formatTransportLabel(opt: TransportOption, to: string): string {
  // Multi-leg routes have a pre-built displaySummary (e.g. "Bus + Flight — 4h total, ~€94/person")
  if (opt.displaySummary) {
    return `→${to} — ${opt.displaySummary}`
  }
  const modeLabel = opt.mode === 'flight' ? 'Flight' : opt.mode === 'train' ? 'Train' : opt.mode === 'bus' ? 'Bus' : 'Drive'
  const ref = opt.flightNumber ?? opt.trainLine ?? ''
  const parts: string[] = [`${modeLabel}${ref ? ` ${ref}` : ''} →${to}`]
  if (opt.priceEur) parts.push(`€${opt.priceEur}/person`)
  parts.push(formatDuration(opt.durationMinutes))
  return parts.join(' — ')
}

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
  const icons: Record<string, string> = { flight: '✈️', train: '🚆', car: '🚗' }
  return icons[mode ?? ''] ?? '→'
}

export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m > 0 ? `${h}h ${m}m` : `${h}h`
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

export interface ItineraryActivity {
  name: string
  category?: string
  location?: string
  duration?: string
  notes?: string
}

export interface ItineraryMeal {
  type: string
  name: string
  location?: string
  rating?: number
}

export interface ItineraryTransport {
  from: string
  to: string
  mode: string
  provider?: string
  durationMinutes?: number
  priceEur?: number
  departureTime?: string
  arrivalTime?: string
  displaySummary?: string
  segments?: Array<Record<string, unknown>>
}

export interface ItineraryDay {
  day: number
  date?: string
  activities: ItineraryActivity[]
  meals?: ItineraryMeal[]
  transport?: ItineraryTransport[]
}

export interface WeatherInfo {
  alerts: string[]
  summary?: string
}

export interface ItineraryData {
  tripName: string
  tripId: string
  startDate?: string
  endDate?: string
  budgetTotal?: number
  budgetCurrency?: string
  travellers?: Array<{ name: string }>
  days: ItineraryDay[]
  weather?: WeatherInfo
}

export interface ShareRecord {
  shareId: string
  tripId: string
  createdBy: string
  itinerary: ItineraryData
  createdAt: string
  expiresAt: string
}

export interface GenerateShareResponse {
  shareId: string
  shareUrl: string
  expiresAt: string
}

export interface GetShareResponse {
  shareId: string
  tripId: string
  itinerary: ItineraryData
  createdAt: string
  expiresAt: string
}

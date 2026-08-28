import { BaseService } from '@itinera/shared';
import { config } from '@/config';

export interface Place {
  id: string;
  name: string;
  location: { lat: number; lng: number };
  category: string;
  rating: number | null;
  /** Google Places price_level (0-4). Only populated by searchRestaurants. */
  priceLevel: number | null;
  /** Neighbourhood / short address. Only populated by searchRestaurants. */
  vicinity?: string;
  openingHours: Record<string, string>;
  metadata: Record<string, unknown>;
}

interface GooglePlacesTextSearchResponse {
  places?: Array<{
    id: string;
    displayName?: { text: string };
    location?: { latitude: number; longitude: number };
    types?: string[];
    rating?: number;
    priceLevel?: string;
    shortFormattedAddress?: string;
    regularOpeningHours?: {
      weekdayDescriptions?: string[];
    };
  }>;
}

// Google Places (New) returns priceLevel as an enum string, not a 1-4 number.
const PRICE_LEVEL_ENUM: Record<string, number> = {
  PRICE_LEVEL_FREE: 0,
  PRICE_LEVEL_INEXPENSIVE: 1,
  PRICE_LEVEL_MODERATE: 2,
  PRICE_LEVEL_EXPENSIVE: 3,
  PRICE_LEVEL_VERY_EXPENSIVE: 4,
};

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export class PlacesService extends BaseService {
  private readonly apiKey: string;
  private readonly baseUrl = config.GOOGLE_PLACES_BASE_URL;

  constructor() {
    super('places-service');
    this.apiKey = config.GOOGLE_PLACES_API_KEY;
  }

  async searchAttractions(region: string, category?: string): Promise<Place[]> {
    const query = category
      ? `${category} attractions in ${region}`
      : `tourist attractions in ${region}`;

    const res = await fetch(`${this.baseUrl}/places:searchText`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': this.apiKey,
        'X-Goog-FieldMask':
          'places.id,places.displayName,places.location,places.types,places.rating,places.regularOpeningHours',
      },
      body: JSON.stringify({ textQuery: query, maxResultCount: 20 }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Google Places API error ${res.status}: ${body}`);
    }

    const data = (await res.json()) as GooglePlacesTextSearchResponse;
    return (data.places ?? []).map((p) => this.mapPlace(p, category ?? 'attraction'));
  }

  async searchRestaurants(region: string): Promise<Place[]> {
    if (config.PLACES_MOCK) return mockRestaurants(region);

    const res = await fetch(`${this.baseUrl}/places:searchText`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': this.apiKey,
        'X-Goog-FieldMask':
          'places.id,places.displayName,places.location,places.types,places.rating,places.priceLevel,places.shortFormattedAddress',
      },
      body: JSON.stringify({ textQuery: `restaurants in ${region}`, maxResultCount: 20 }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Google Places API error ${res.status}: ${body}`);
    }

    const data = (await res.json()) as GooglePlacesTextSearchResponse;
    return (data.places ?? []).map((p) => this.mapPlace(p, 'restaurant'));
  }

  /**
   * Geocode a place name (city, town, region) to a coordinate via Places Text
   * Search. Used to resolve a destination to its nearest airport for flight
   * search. Returns null when no place matches.
   */
  async geocodePlace(query: string): Promise<{ lat: number; lng: number } | null> {
    const res = await fetch(`${this.baseUrl}/places:searchText`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': this.apiKey,
        'X-Goog-FieldMask': 'places.location',
      },
      body: JSON.stringify({ textQuery: query, maxResultCount: 1 }),
    });

    if (!res.ok) {
      throw new Error(`Google Places API error ${res.status}: ${await res.text()}`);
    }

    const data = (await res.json()) as GooglePlacesTextSearchResponse;
    const loc = data.places?.[0]?.location;
    if (loc?.latitude === undefined || loc?.longitude === undefined) return null;
    return { lat: loc.latitude, lng: loc.longitude };
  }

  private mapPlace(
    p: NonNullable<GooglePlacesTextSearchResponse['places']>[number],
    defaultCategory: string,
  ): Place {
    const openingHours: Record<string, string> = {};
    for (const desc of p.regularOpeningHours?.weekdayDescriptions ?? []) {
      const [day, hours] = desc.split(': ');
      if (day && hours) {
        const normalized = DAY_NAMES.find((d) => desc.startsWith(d)) ?? day;
        openingHours[normalized] = hours;
      }
    }

    return {
      id: p.id ?? '',
      name: p.displayName?.text ?? '',
      location: {
        lat: p.location?.latitude ?? 0,
        lng: p.location?.longitude ?? 0,
      },
      category: p.types?.[0] ?? defaultCategory,
      rating: p.rating ?? null,
      priceLevel: p.priceLevel ? PRICE_LEVEL_ENUM[p.priceLevel] ?? null : null,
      ...(p.shortFormattedAddress ? { vicinity: p.shortFormattedAddress } : {}),
      openingHours,
      metadata: { types: p.types ?? [] },
    };
  }
}

/**
 * Deterministic fixture restaurants for `PLACES_MOCK=true` dev/test — varied
 * price levels, ratings and neighbourhoods so meal-pick ranking and rotation
 * are exercised offline without burning Google Places quota.
 */
function mockRestaurants(region: string): Place[] {
  const base: Array<Omit<Place, 'id' | 'location' | 'openingHours' | 'metadata'>> = [
    { name: `${region} Tasca do Mercado`, category: 'restaurant', rating: 4.7, priceLevel: 1, vicinity: 'Centro' },
    { name: `Cantina ${region}`, category: 'restaurant', rating: 4.5, priceLevel: 2, vicinity: 'Baixa' },
    { name: `${region} Grill House`, category: 'restaurant', rating: 4.3, priceLevel: 2, vicinity: 'Ribeira' },
    { name: `Osteria ${region}`, category: 'restaurant', rating: 4.2, priceLevel: 3, vicinity: 'Bairro Alto' },
    { name: `${region} Street Food Corner`, category: 'restaurant', rating: 4.0, priceLevel: 0, vicinity: 'Mercado' },
  ];
  return base.map((r, i) => ({
    ...r,
    id: `mock-restaurant-${region.toLowerCase().replace(/\s+/g, '-')}-${i}`,
    location: { lat: 0, lng: 0 },
    openingHours: {},
    metadata: { types: ['restaurant'], mock: true },
  }));
}

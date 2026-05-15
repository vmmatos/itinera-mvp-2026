import { BaseService } from '@itinera/shared';
import { config } from '@/config';

export interface Place {
  id: string;
  name: string;
  location: { lat: number; lng: number };
  category: string;
  rating: number | null;
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
    regularOpeningHours?: {
      weekdayDescriptions?: string[];
    };
  }>;
}

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
      openingHours,
      metadata: { types: p.types ?? [] },
    };
  }
}
